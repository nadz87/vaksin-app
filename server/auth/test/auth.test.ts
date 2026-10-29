// Security tests for the sign-in service, against a real Postgres (`npm run api:up` first).
// A fresh database `vaksin_authtest` gets every migration; the service connects as the
// restricted vaksin_auth role, exactly as in production. Emails go to an in-memory outbox.
import { SignJWT, decodeJwt } from 'jose'
import * as OTPAuth from 'otpauth'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dbUrl, devEnv } from '../../dev.mjs'
import { migrate } from '../../migrate.mjs'
import { LIMITS, createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { hashPassword } from '../src/secrets.ts'

const env = devEnv()
const DB = 'vaksin_authtest'
const authUrl = dbUrl(env, DB).replace(/^postgres:\/\/postgres:[^@]+@/, `postgres://vaksin_auth:${env.AUTH_DB_PASSWORD}@`)
const config = loadConfig({
  DATABASE_URL: authUrl,
  JWT_SECRET: env.JWT_SECRET,
  OTP_PEPPER: env.OTP_PEPPER,
  TOTP_ENC_KEY: env.TOTP_ENC_KEY,
  SMTP_HOST: 'unused',
  MAIL_FROM: 'test@example.com',
})

let db: pg.Pool
let admin: pg.Pool // superuser, only to arrange test situations (expire a code, etc.)
const outbox: { to: string; code: string }[] = []
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const root = new pg.Client({ connectionString: dbUrl(env, 'postgres') })
  await root.connect()
  await root.query(`drop database if exists ${DB} with (force)`)
  await root.query(`create database ${DB}`)
  await root.end()
  await migrate({ url: dbUrl(env, DB), authenticatorPassword: env.AUTHENTICATOR_PASSWORD, authDbPassword: env.AUTH_DB_PASSWORD, log: () => {} })
  db = new pg.Pool({ connectionString: authUrl })
  admin = new pg.Pool({ connectionString: dbUrl(env, DB) })
  app = createApp({ config, db, mailer: { sendCode: async (to, code) => void outbox.push({ to, code }) } })
}, 60_000)

afterAll(async () => {
  await db?.end()
  await admin?.end()
})

// Each test uses its own email and client address so rate limits never leak between tests.
let n = 0
const unique = (prefix = 'parent') => `${prefix}.${Date.now()}.${++n}@test.local`
const ipFor = () => `10.0.${Math.floor(n / 250)}.${n % 250}`

async function call(path: string, init: { body?: unknown; token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-real-ip': init.ip ?? ipFor() }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(init.body ?? {}) })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const lastCode = (email: string) => [...outbox].reverse().find((m) => m.to === email)?.code

async function signInParent(email = unique()) {
  await call('/email/start', { body: { email } })
  const res = await call('/email/verify', { body: { email, code: lastCode(email) } })
  expect(res.status).toBe(200)
  return { email, ...res.json } as { email: string; access_token: string; refresh_token: string }
}

async function makeStaff(role: 'officer' | 'platform_admin' = 'officer', password = 'a-long-test-password') {
  const email = unique('staff')
  const { rows } = await db.query('insert into auth.users (email, password_hash) values ($1, $2) returning id', [email, await hashPassword(password)])
  await db.query('select auth_private.set_staff_role($1, $2, null)', [rows[0].id, role])
  return { email, password, id: rows[0].id as string }
}

async function staffSession(password?: string) {
  const staff = await makeStaff('officer', password)
  const res = await call('/password', { body: { email: staff.email, password: staff.password } })
  expect(res.status).toBe(200)
  return { ...staff, access: res.json.access_token as string, refresh: res.json.refresh_token as string }
}

const totpFor = (secret: string) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) })

describe('email codes', () => {
  it('sends a code and gives the same reply for new and existing emails', async () => {
    const known = await signInParent()
    // signInParent just asked for a code; clear the 1-a-minute counter for a fair comparison.
    await admin.query('delete from auth_private.rate_events where key = $1', [`start:email:${known.email}`])
    const fresh = unique()
    const a = await call('/email/start', { body: { email: fresh } })
    const b = await call('/email/start', { body: { email: known.email } })
    expect(a).toEqual(b)
    expect(a).toEqual({ status: 200, json: { ok: true } })
    expect(lastCode(fresh)).toMatch(/^\d{6}$/)
  })

  it('does not create an account until the code is verified', async () => {
    const email = unique()
    await call('/email/start', { body: { email } })
    expect((await admin.query('select 1 from auth.users where email = $1', [email])).rowCount).toBe(0)
  })

  it('rejects malformed emails', async () => {
    expect((await call('/email/start', { body: { email: 'not-an-email' } })).status).toBe(400)
  })

  it('signs in with the code and creates a parent profile; tokens carry the expected claims', async () => {
    const parent = await signInParent()
    const claims = decodeJwt(parent.access_token)
    expect(claims).toMatchObject({ aud: 'authenticated', role: 'authenticated', aal: 'aal1', email: parent.email })
    expect(claims.exp! - claims.iat!).toBe(15 * 60)
    const { rows } = await admin.query('select p.role from public.profiles p join auth.users u on u.id = p.user_id where u.email = $1', [parent.email])
    expect(rows[0].role).toBe('parent')
  })

  it('stores only a hash of the code', async () => {
    const email = unique()
    await call('/email/start', { body: { email } })
    const { rows } = await admin.query('select code_hash from auth_private.email_codes where email = $1', [email])
    expect(rows[0].code_hash).not.toContain(lastCode(email))
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('locks the code after 5 wrong tries, even for the right code', async () => {
    const email = unique()
    await call('/email/start', { body: { email } })
    const right = lastCode(email)!
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < LIMITS.codeTries; i++) expect((await call('/email/verify', { body: { email, code: wrong } })).status).toBe(400)
    expect((await call('/email/verify', { body: { email, code: right } })).json.error).toBe('otp_invalid')
  })

  it('refuses an expired code and a code used twice', async () => {
    const email = unique()
    await call('/email/start', { body: { email } })
    await admin.query(`update auth_private.email_codes set expires_at = now() - interval '1 second' where email = $1`, [email])
    expect((await call('/email/verify', { body: { email, code: lastCode(email) } })).status).toBe(400)

    const again = await signInParent()
    const reused = await call('/email/verify', { body: { email: again.email, code: lastCode(again.email) } })
    expect(reused.json.error).toBe('otp_invalid')
  })

  it('limits codes per email (1 a minute) and per address (20 an hour)', async () => {
    const email = unique()
    expect((await call('/email/start', { body: { email } })).status).toBe(200)
    expect((await call('/email/start', { body: { email } })).json.error).toBe('rate_limited')

    const ip = '192.0.2.77'
    for (let i = 0; i < LIMITS.startPerIpHour; i++) expect((await call('/email/start', { body: { email: unique() }, ip })).status).toBe(200)
    expect((await call('/email/start', { body: { email: unique() }, ip })).json.error).toBe('rate_limited')
  })
})

describe('tokens and sessions', () => {
  it('refuses forged, expired, wrong-audience and unsigned tokens', async () => {
    const parent = await signInParent()
    const { sub, sid } = decodeJwt(parent.access_token) as { sub: string; sid: string }
    const sign = (secret: string, claims: object, exp = '5m') =>
      new SignJWT({ role: 'authenticated', aal: 'aal1', sid, ...claims }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
        .setAudience((claims as { aud?: string }).aud ?? 'authenticated').setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secret))
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, sid, aud: 'authenticated', exp: 9e9 })).toString('base64url')}.`
    const bad = [
      await sign('x'.repeat(64), {}),
      await sign(env.JWT_SECRET, { aud: 'someone-else' }),
      await sign(env.JWT_SECRET, {}, '-1m'),
      unsigned,
      parent.access_token.slice(0, -2) + (parent.access_token.endsWith('A') ? 'BB' : 'AA'),
    ]
    for (const token of bad) expect((await call('/password/change', { token, body: {} })).json.error).toBe('invalid_token')
  })

  it('rotates refresh tokens; an old one reused later ends the whole session', async () => {
    const parent = await signInParent()
    const first = await call('/refresh', { body: { refresh_token: parent.refresh_token } })
    expect(first.status).toBe(200)
    expect(first.json.refresh_token).not.toBe(parent.refresh_token)

    // Straight away: probably another tab refreshing at the same moment, not theft.
    expect((await call('/refresh', { body: { refresh_token: parent.refresh_token } })).json.error).toBe('refresh_race')

    // Later: the old token was copied. The session ends, including the new token.
    await admin.query(`update auth_private.refresh_tokens set used_at = now() - interval '1 minute' where used_at is not null`)
    expect((await call('/refresh', { body: { refresh_token: parent.refresh_token } })).json.error).toBe('session_revoked')
    expect((await call('/refresh', { body: { refresh_token: first.json.refresh_token } })).json.error).toBe('session_revoked')
    expect((await call('/password/change', { token: first.json.access_token, body: {} })).json.error).toBe('invalid_token')
  })

  it('signs out: the access token and refresh token stop working', async () => {
    const parent = await signInParent()
    expect((await call('/logout', { token: parent.access_token })).status).toBe(200)
    expect((await call('/password/change', { token: parent.access_token, body: {} })).json.error).toBe('invalid_token')
    expect((await call('/refresh', { body: { refresh_token: parent.refresh_token } })).json.error).toBe('session_revoked')
  })

  it('a disabled account cannot refresh, and gets no codes', async () => {
    const parent = await signInParent()
    await admin.query('update auth.users set disabled_at = now() where email = $1', [parent.email])
    expect((await call('/refresh', { body: { refresh_token: parent.refresh_token } })).json.error).toBe('session_revoked')
    const before = outbox.length
    await admin.query(`delete from auth_private.rate_events where key like $1`, [`%${parent.email}`])
    expect((await call('/email/start', { body: { email: parent.email } })).json).toEqual({ ok: true })
    expect(outbox.length).toBe(before)
  })
})

describe('staff passwords', () => {
  it('signs staff in and gives parents (no password) the same answer as a wrong password', async () => {
    const staff = await makeStaff()
    const ok = await call('/password', { body: { email: staff.email, password: staff.password } })
    expect(ok.status).toBe(200)
    expect(ok.json.user.role).toBe('officer')
    const parent = await signInParent()
    const a = await call('/password', { body: { email: parent.email, password: 'whatever-password' } })
    const b = await call('/password', { body: { email: unique(), password: 'whatever-password' } })
    expect(a).toEqual(b)
    expect(a.json.error).toBe('invalid_credentials')
  })

  it('locks for 15 minutes after 5 wrong passwords, even for the right one', async () => {
    const staff = await makeStaff()
    for (let i = 0; i < LIMITS.passwordTries; i++) await call('/password', { body: { email: staff.email, password: 'wrong-password!' } })
    expect((await call('/password', { body: { email: staff.email, password: staff.password } })).json.error).toBe('locked')
  })

  it('changes the password: checks the old one and length, and signs out other devices', async () => {
    const staff = await staffSession()
    const other = await call('/password', { body: { email: staff.email, password: staff.password } })
    expect((await call('/password/change', { token: staff.access, body: { old_password: staff.password, new_password: 'short' } })).json.error).toBe('weak_password')
    expect((await call('/password/change', { token: staff.access, body: { old_password: 'not-the-old-one', new_password: 'a-brand-new-password' } })).json.error).toBe('invalid_credentials')
    expect((await call('/password/change', { token: staff.access, body: { old_password: staff.password, new_password: 'a-brand-new-password' } })).status).toBe(200)
    expect((await call('/refresh', { body: { refresh_token: other.json.refresh_token } })).json.error).toBe('session_revoked')
    expect((await call('/password', { body: { email: staff.email, password: 'a-brand-new-password' } })).status).toBe(200)
  })
})

describe('authenticator app (2-step)', () => {
  it('is for staff only', async () => {
    const parent = await signInParent()
    expect((await call('/mfa/enroll', { token: parent.access_token })).json.error).toBe('not_staff')
  })

  it('needs the temporary password changed first', async () => {
    const staff = await makeStaff()
    await db.query('update auth.users set must_change_password = true where id = $1', [staff.id])
    const signedIn = await call('/password', { body: { email: staff.email, password: staff.password } })
    expect(signedIn.json.must_change_password).toBe(true)
    const token = signedIn.json.access_token
    expect((await call('/mfa/enroll', { token })).json.error).toBe('password_change_required')
    expect((await call('/mfa/verify', { token, body: { code: '123456' } })).json.error).toBe('password_change_required')
    await call('/password/change', { token, body: { old_password: staff.password, new_password: 'a-brand-new-password' } })
    expect((await call('/mfa/enroll', { token })).status).toBe(200)
  })

  it('enrols, raises the session to aal2, and refuses a code used twice or out of time', async () => {
    const staff = await staffSession()
    const enrol = await call('/mfa/enroll', { token: staff.access })
    expect(enrol.json.uri).toMatch(/^otpauth:\/\/totp\/Vaksin%20App:/)
    const totp = totpFor(enrol.json.secret)

    const stored = await admin.query('select secret_enc from auth_private.mfa_factors where user_id = $1', [staff.id])
    expect(stored.rows[0].secret_enc.toString('latin1')).not.toContain(enrol.json.secret)

    expect((await call('/mfa/verify', { token: staff.access, body: { code: totp.generate({ timestamp: Date.now() - 90_000 }) } })).json.error).toBe('mfa_invalid')

    const code = totp.generate()
    const ok = await call('/mfa/verify', { token: staff.access, body: { code } })
    expect(ok.status).toBe(200)
    expect(decodeJwt(ok.json.access_token).aal).toBe('aal2')
    expect((await call('/mfa/verify', { token: ok.json.access_token, body: { code } })).json.error).toBe('mfa_invalid')

    // The session stays aal2 across refreshes; the pre-2FA refresh token is retired.
    const refreshed = await call('/refresh', { body: { refresh_token: ok.json.refresh_token } })
    expect(decodeJwt(refreshed.json.access_token).aal).toBe('aal2')
    expect((await call('/refresh', { body: { refresh_token: staff.refresh } })).status).not.toBe(200)

    // Once set up, a second enrolment is refused (an admin resets it instead).
    expect((await call('/mfa/enroll', { token: refreshed.json.access_token })).json.error).toBe('mfa_already_enrolled')
  })

  it('locks after 5 wrong codes', async () => {
    const staff = await staffSession()
    const totp = totpFor((await call('/mfa/enroll', { token: staff.access })).json.secret)
    for (let i = 0; i < LIMITS.mfaTries; i++) await call('/mfa/verify', { token: staff.access, body: { code: '000000' } })
    expect((await call('/mfa/verify', { token: staff.access, body: { code: totp.generate() } })).json.error).toBe('locked')
  })
})
