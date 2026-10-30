// The sign-in API. Mounted by the gateway at /auth/ (the prefix is removed before it
// reaches here). Every error is a short code the website translates, e.g. {"error":"otp_invalid"}.
import { Hono, type Context } from 'hono'
import type pg from 'pg'
import type { Config } from './config.ts'
import type { Mailer } from './mail.ts'
import { recent, record, tidy } from './rate.ts'
import { hashEmailCode, newEmailCode, sameText } from './secrets.ts'
import { currentSession, hashToken, issueTokens, startSession, userRole, type Aal } from './sessions.ts'

export const LIMITS = {
  codeMinutes: 10,
  codeTries: 5,
  startPerEmailMinute: 1,
  startPerEmailHour: 5,
  startPerIpHour: 20,
  invitesPerHour: 30,
  lockSeconds: 15 * 60,
  refreshRaceSeconds: 10,
}

type Deps = { config: Config; db: pg.Pool; mailer: Mailer }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailOf(body: unknown): string | null {
  const raw = (body as { email?: unknown })?.email
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

function text(body: unknown, field: string, max = 200): string | null {
  const value = (body as Record<string, unknown>)?.[field]
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503, error: string) => c.json({ error }, status)

// The gateway is the only way in, and it sets X-Real-IP from Cloudflare's CF-Connecting-IP.
const clientIp = (c: Context) => c.req.header('x-real-ip') ?? 'unknown'

async function body(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null)
}

export function createApp({ config, db, mailer }: Deps) {
  const app = new Hono()

  app.use(async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    if (Math.random() < 0.02) tidy(db).catch(() => {})
  })

  app.get('/health', async (c) => {
    try {
      await db.query('select 1')
      return c.json({ ok: true })
    } catch {
      return fail(c, 503, 'database_unavailable')
    }
  })

  // 1. Parent (and anyone) sign-in: ask for a code. The reply is the same whether or not
  //    the email has an account, so this cannot be used to find out who is registered.
  app.post('/email/start', async (c) => {
    const email = emailOf(await body(c))
    if (!email) return fail(c, 400, 'invalid_email')
    const ip = clientIp(c)
    if (
      (await recent(db, `start:email:${email}`, 60)) >= LIMITS.startPerEmailMinute ||
      (await recent(db, `start:email:${email}`, 3600)) >= LIMITS.startPerEmailHour ||
      (await recent(db, `start:ip:${ip}`, 3600)) >= LIMITS.startPerIpHour
    ) {
      return fail(c, 429, 'rate_limited')
    }
    await record(db, `start:email:${email}`, `start:ip:${ip}`)

    const { rows } = await db.query('select disabled_at from auth.users where lower(email) = $1', [email])
    if (rows[0]?.disabled_at) return c.json({ ok: true })

    const code = newEmailCode()
    await db.query('delete from auth_private.email_codes where lower(email) = $1', [email])
    await db.query(
      `insert into auth_private.email_codes (email, code_hash, expires_at)
       values ($1, $2, now() + make_interval(mins => $3))`,
      [email, hashEmailCode(config.otpPepper, email, code), LIMITS.codeMinutes],
    )
    try {
      await mailer.sendCode(email, code)
    } catch (error) {
      console.error('email send failed', (error as Error).message)
      return fail(c, 502, 'email_failed')
    }
    return c.json({ ok: true })
  })

  // 2. Check the code. A new email gets its account (and parent profile) only now.
  app.post('/email/verify', async (c) => {
    const input = await body(c)
    const email = emailOf(input)
    const code = text(input, 'code', 6)
    if (!email || !code || !/^\d{6}$/.test(code)) return fail(c, 400, 'otp_invalid')

    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        `select id, code_hash, attempts, expires_at > now() as live from auth_private.email_codes
          where lower(email) = $1 order by created_at desc limit 1 for update`,
        [email],
      )
      const row = rows[0]
      if (!row || !row.live || row.attempts >= LIMITS.codeTries) {
        await client.query('commit')
        return fail(c, 400, 'otp_invalid')
      }
      if (!sameText(row.code_hash, hashEmailCode(config.otpPepper, email, code))) {
        await client.query('update auth_private.email_codes set attempts = attempts + 1 where id = $1', [row.id])
        await client.query('commit')
        return fail(c, 400, 'otp_invalid')
      }
      await client.query('delete from auth_private.email_codes where lower(email) = $1', [email])
      const { rows: users } = await client.query(
        // Staff sign in this way too (no passwords): proving the inbox replaces any old
        // temporary password, which is cleared so it can never be used.
        `insert into auth.users (email, last_sign_in_at) values ($1, now())
         on conflict (lower(email)) do update
           set last_sign_in_at = now(), password_hash = null, must_change_password = false
         returning id, email, disabled_at, must_change_password`,
        [email],
      )
      if (users[0].disabled_at) {
        await client.query('commit')
        return fail(c, 403, 'account_disabled')
      }
      const tokens = await startSession(config, client, users[0], c.req.header('user-agent'))
      await client.query('commit')
      return c.json(tokens)
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })

  // 3. Swap a refresh token for new tokens. Each refresh token works once; using an old one
  //    again means it was copied, so the whole session ends. Two tabs refreshing at the same
  //    moment are not theft: within 10 seconds the late one is told to re-read the new tokens.
  app.post('/refresh', async (c) => {
    const token = text(await body(c), 'refresh_token', 100)
    if (!token) return fail(c, 401, 'invalid_token')
    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        `select r.session_id, r.used_at, now() - r.used_at < make_interval(secs => $2) as racing,
                s.aal, s.revoked_at, s.expires_at > now() as live, u.id, u.email, u.disabled_at, u.must_change_password
           from auth_private.refresh_tokens r
           join auth_private.sessions s on s.id = r.session_id
           join auth.users u on u.id = s.user_id
          where r.token_hash = $1
          for update of r`,
        [hashToken(token), LIMITS.refreshRaceSeconds],
      )
      const row = rows[0]
      if (!row) {
        await client.query('commit')
        return fail(c, 401, 'invalid_token')
      }
      if (row.revoked_at || !row.live || row.disabled_at) {
        await client.query('commit')
        return fail(c, 401, 'session_revoked')
      }
      if (row.used_at) {
        if (row.racing) {
          await client.query('commit')
          return fail(c, 409, 'refresh_race')
        }
        await client.query('update auth_private.sessions set revoked_at = now() where id = $1', [row.session_id])
        await client.query('commit')
        return fail(c, 401, 'session_revoked')
      }
      await client.query('update auth_private.refresh_tokens set used_at = now() where token_hash = $1', [hashToken(token)])
      const tokens = await issueTokens(
        config,
        client,
        { id: row.id, email: row.email },
        row.session_id,
        row.aal as Aal,
        await userRole(client, row.id),
        row.must_change_password,
      )
      await client.query('commit')
      return c.json(tokens)
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })

  // 4. Platform admin invites a health officer: the account is made (role officer) and an
  //    invitation email with the officer page link goes out. Inviting again resends it.
  app.post('/invite', async (c) => {
    const me = await currentSession(config, db, c.req.header('authorization'))
    if (!me) return fail(c, 401, 'invalid_token')
    if (me.role !== 'platform_admin' || me.aal !== 'aal2') return fail(c, 403, 'not_allowed')
    const email = emailOf(await body(c))
    if (!email) return fail(c, 400, 'invalid_email')
    const key = `invite:${me.userId}`
    if ((await recent(db, key, 3600)) >= LIMITS.invitesPerHour) return fail(c, 429, 'rate_limited')
    await record(db, key)

    let alreadyRegistered: boolean
    try {
      const { rows } = await db.query('select already_registered from auth_private.invite_officer($1, $2)', [me.userId, email])
      alreadyRegistered = rows[0].already_registered
    } catch (error) {
      // The database refuses with a short code: already_admin, email_is_parent, ...
      const code = (error as Error).message
      if (/^[a-z_]+$/.test(code)) return fail(c, 400, code)
      throw error
    }
    try {
      await mailer.sendInvite(email, `${config.siteUrl}#/officer`)
    } catch (error) {
      console.error('invite send failed', (error as Error).message)
      return fail(c, 502, 'email_failed')
    }
    return c.json({ ok: true, already_registered: alreadyRegistered })
  })

  // 5. Sign out this device.
  app.post('/logout', async (c) => {
    const me = await currentSession(config, db, c.req.header('authorization'))
    if (me) await db.query('update auth_private.sessions set revoked_at = now() where id = $1', [me.sessionId])
    return c.json({ ok: true })
  })

  app.notFound((c) => fail(c, 404, 'not_found'))
  app.onError((error, c) => {
    console.error(error)
    return c.json({ error: 'server_error' }, 500)
  })
  return app
}
