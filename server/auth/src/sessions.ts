// Sessions and tokens. The access token carries the same claims Supabase used, so the
// database rules (auth.uid(), has_aal2()) work unchanged behind PostgREST.
import { SignJWT, jwtVerify } from 'jose'
import type pg from 'pg'
import type { Config } from './config.ts'
import { hashToken, newRefreshToken } from './secrets.ts'

export type Aal = 'aal1' | 'aal2'
export type SessionUser = { userId: string; email: string; sessionId: string; aal: Aal; role: string }
export type Tokens = {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string; email: string; role: string }
  aal: Aal
  must_change_password: boolean
}

export const STAFF_ROLES = new Set(['officer', 'platform_admin'])

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>

export async function userRole(db: Queryable, userId: string): Promise<string> {
  const { rows } = await db.query('select auth_private.user_role($1) as role', [userId])
  return rows[0]?.role ?? 'parent'
}

export async function accessToken(config: Config, user: { id: string; email: string }, sessionId: string, aal: Aal) {
  return new SignJWT({ email: user.email, role: 'authenticated', aal, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSeconds}s`)
    .sign(config.jwtSecret)
}

/** Starts a new signed-in session (always aal1; the authenticator check raises it). */
export async function startSession(
  config: Config,
  db: Queryable,
  user: { id: string; email: string; must_change_password?: boolean },
  userAgent: string | undefined,
): Promise<Tokens> {
  const role = await userRole(db, user.id)
  const lifetime = STAFF_ROLES.has(role) ? config.staffSessionSeconds : config.parentSessionSeconds
  const { rows } = await db.query(
    `insert into auth_private.sessions (user_id, expires_at, user_agent)
     values ($1, now() + make_interval(secs => $2), left($3, 300)) returning id`,
    [user.id, lifetime, userAgent ?? null],
  )
  return issueTokens(config, db, user, rows[0].id, 'aal1', role, user.must_change_password ?? false)
}

export async function issueTokens(
  config: Config,
  db: Queryable,
  user: { id: string; email: string },
  sessionId: string,
  aal: Aal,
  role: string,
  mustChangePassword: boolean,
): Promise<Tokens> {
  const refresh = newRefreshToken()
  await db.query('insert into auth_private.refresh_tokens (token_hash, session_id) values ($1, $2)', [refresh.hash, sessionId])
  return {
    access_token: await accessToken(config, user, sessionId, aal),
    refresh_token: refresh.token,
    expires_in: config.accessTtlSeconds,
    user: { id: user.id, email: user.email, role },
    aal,
    must_change_password: mustChangePassword,
  }
}

/**
 * Checks the Bearer token and that its session is still live (not signed out, not expired,
 * account not disabled). Returns null when any of that fails.
 */
export async function currentSession(config: Config, db: Queryable, authorization: string | undefined): Promise<SessionUser | null> {
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return null
  let sub: string, sid: string, tokenAal: unknown
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { audience: 'authenticated', algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
    sub = payload.sub
    sid = payload.sid
    tokenAal = payload.aal
  } catch {
    return null
  }
  const { rows } = await db.query(
    `select s.id, s.aal, u.id as user_id, u.email
       from auth_private.sessions s join auth.users u on u.id = s.user_id
      where s.id = $1 and s.user_id = $2 and s.revoked_at is null and s.expires_at > now() and u.disabled_at is null`,
    [sid, sub],
  )
  if (!rows[0]) return null
  // 2-step counts only when both agree: the token says so (as the database rules require)
  // and the session passed it. A token issued before the 2-step check stays aal1.
  const aal: Aal = tokenAal === 'aal2' && rows[0].aal === 'aal2' ? 'aal2' : 'aal1'
  return { userId: rows[0].user_id, email: rows[0].email, sessionId: rows[0].id, aal, role: await userRole(db, sub) }
}

export async function revokeSessions(db: Queryable, userId: string, exceptSessionId?: string) {
  await db.query(
    `update auth_private.sessions set revoked_at = now()
      where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2)`,
    [userId, exceptSessionId ?? null],
  )
}

export { hashToken }
