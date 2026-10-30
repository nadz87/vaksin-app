// End-to-end checks of the local stack through the gateway: anonymous access, signed and
// forged tokens, 2FA rule, CORS, and real parent and officer sign-ins.
// Needs `npm run api:up` first. Usage: npm run api:check
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'


const envFile = new URL('.env.dev', import.meta.url)
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const API = 'http://127.0.0.1:4011'
const psql = (sql) => execFileSync('docker', ['exec', 'vaksin-dev-db-1', 'psql', '-U', 'postgres', '-d', 'vaksin', '-Atc', sql], { encoding: 'utf8' }).trim()
// Database clock, not this PC's: Docker's clock can differ by a few seconds.
const startedAt = psql('select now()')
const OFFICER = '00000000-0000-0000-0000-00000000aaaa'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(claims, { secret = env.JWT_SECRET, alg = 'HS256' } = {}) {
  const head = b64({ alg, typ: 'JWT' })
  const body = b64({ aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 300, ...claims })
  if (alg === 'none') return `${head}.${body}.`
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}
async function call(path, { token, method = 'GET', body, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (origin) headers.Origin = origin
  let res, text
  // The gateway's flood limit answers with nginx's own 429 page (not JSON) when checks run
  // back to back. Wait and retry; the sign-in service's JSON 429s are real results.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    text = await res.text()
    if (res.status !== 429 || text.startsWith('{') || attempt === 10) break
    await new Promise((r) => setTimeout(r, 600))
  }
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, cors: res.headers.get('access-control-allow-origin') }
}

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  -> ${String(JSON.stringify(detail)).slice(0, 200)}`}`)
  if (!ok) failed++
}

const schools = await call('/rest/rpc/list_schools', { method: 'POST', body: {} })
check('anon can list the 27 schools (16 SKPP + 11 SMKPP)', schools.status === 200 && schools.json.length === 27, schools)

const kids = await call('/rest/students?select=id')
check('anon sees no students (row-level security)', kids.status === 200 && kids.json.length === 0, kids)
const ids = await call('/rest/student_identifiers?select=*')
check('anon sees no MyKid numbers', ids.status === 200 && ids.json.length === 0, ids)
for (const path of ['/rest/users', '/rest/applied', '/rest/'])
  check(`not exposed: ${path}`, [404, 400, 401, 403].includes((await call(path)).status) && !(Array.isArray((await call(path)).json)), path)

const good2 = jwt({ sub: OFFICER, aal: 'aal2' })
const me = await call(`/rest/profiles?select=role&user_id=eq.${OFFICER}`, { token: good2 })
check('signed token: officer reads own profile', me.status === 200 && me.json[0]?.role === 'officer', me)
const range = { p_from: new Date().toISOString().slice(0, 10), p_to: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) }
const dash2 = await call('/rest/rpc/officer_slots', { method: 'POST', token: good2, body: range })
check('officer at staff level (aal2) sees own calendar', dash2.status === 200 && dash2.json.length > 0, { status: dash2.status, n: dash2.json?.length })
const dash1 = await call('/rest/rpc/officer_slots', { method: 'POST', token: jwt({ sub: OFFICER, aal: 'aal1' }), body: range })
check('an aal1 officer token is refused the calendar', dash1.status >= 400, dash1)

const forged = [
  ['wrong secret', jwt({ sub: OFFICER, aal: 'aal2' }, { secret: 'not-the-secret' })],
  ['alg none', jwt({ sub: OFFICER, aal: 'aal2' }, { alg: 'none' })],
  ['wrong audience', jwt({ sub: OFFICER, aal: 'aal2', aud: 'someone-else' })],
  ['expired', jwt({ sub: OFFICER, aal: 'aal2', exp: Math.floor(Date.now() / 1000) - 60 })],
  ['role escalation to postgres', jwt({ sub: OFFICER, aal: 'aal2', role: 'postgres' })],
]
for (const [name, token] of forged) {
  const r = await call('/rest/students?select=id', { token })
  check(`refused: ${name}`, r.status === 401 || r.status === 403, r)
}

const allowed = await call('/rest/rpc/list_schools', { method: 'POST', body: {}, origin: 'http://localhost:5173' })
check('CORS: website origin allowed', allowed.cors === 'http://localhost:5173', allowed.cors)
const evil = await call('/rest/rpc/list_schools', { method: 'POST', body: {}, origin: 'https://evil.example' })
check('CORS: other origin gets no allow header', !evil.cors, evil.cors)
const health = await call('/auth/health')
check('sign-in service is up behind the gateway', health.status === 200, health)

// Real sign-in, end to end: gateway -> sign-in service -> email (Mailpit) -> token -> PostgREST.
async function codeFromInbox(email) {
  for (let i = 0; i < 20; i++) {
    const found = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()
    if (found.messages?.length) {
      const message = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${found.messages[0].ID}`)).json()
      return message.Text.match(/\b(\d{6})\b/)?.[1]
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}
const parentEmail = `check.${Date.now()}@test.local`
await call('/auth/email/start', { method: 'POST', body: { email: parentEmail } })
const signedIn = await call('/auth/email/verify', { method: 'POST', body: { email: parentEmail, code: await codeFromInbox(parentEmail) } })
check('parent signs in with the emailed code', signedIn.status === 200 && signedIn.json.aal === 'aal1', signedIn)
const own = await call(`/rest/profiles?select=email,role`, { token: signedIn.json.access_token })
check('PostgREST accepts the real token: parent sees only own profile',
  own.status === 200 && own.json.length === 1 && own.json[0].email === parentEmail && own.json[0].role === 'parent', own)
const spoofEmail = `spoof.${Date.now()}@test.local`
const spoofed = await fetch(`${API}/auth/email/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.9' },
  body: JSON.stringify({ email: spoofEmail }),
})
const spoofCount = psql(`select count(*) from auth_private.rate_events where key = 'start:ip:203.0.113.9'`)
check('a caller cannot fake its address (X-Real-IP is overwritten by the gateway)', spoofed.status === 200 && spoofCount === '0', { status: spoofed.status, spoofCount })
await call('/auth/logout', { method: 'POST', token: signedIn.json.access_token })
const after = await call('/auth/refresh', { method: 'POST', body: { refresh_token: signedIn.json.refresh_token } })
check('after sign-out the refresh token is dead', after.status === 401, after)

// Staff, end to end (no passwords, no authenticator app): an admin from the server CLI signs
// in with a code, invites an officer by email, the officer signs in the same way,
// chooses a school, and the admin sees it.
async function staffSignIn(email) {
  await call('/auth/email/start', { method: 'POST', body: { email } })
  return call('/auth/email/verify', { method: 'POST', body: { email, code: await codeFromInbox(email) } })
}
const adminEmail = `admin.${Date.now()}@test.local`
const staffEmail = `officer.${Date.now()}@test.local`
const cliOut = execFileSync('docker', ['exec', 'vaksin-dev-auth-1', 'node', 'src/cli.ts', 'create-staff', '--email', adminEmail, '--role', 'platform_admin'], { encoding: 'utf8' })
check('CLI creates a platform admin (no password)', cliOut.includes('is now platform_admin'), cliOut)
const adminIn = await staffSignIn(adminEmail)
check('admin signs in with an emailed code only (aal2 straight away)', adminIn.status === 200 && adminIn.json.aal === 'aal2', adminIn.json)

const invite = await call('/auth/invite', { method: 'POST', token: adminIn.json.access_token, body: { email: staffEmail } })
const inviteMail = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${staffEmail} subject:Jemputan`)}`)).json()
const inviteBody = inviteMail.messages?.[0]
  ? (await (await fetch(`http://127.0.0.1:8025/api/v1/message/${inviteMail.messages[0].ID}`)).json()).Text
  : ''
check('admin invites an officer: the email carries the officer page link',
  invite.status === 200 && inviteBody.includes('/vaksin-app/#/officer'), { status: invite.status, body: inviteBody.slice(0, 80) })

const officerIn = await staffSignIn(staffEmail)
check('the invited officer signs in the same way (aal2)', officerIn.status === 200 && officerIn.json.user?.role === 'officer' && officerIn.json.aal === 'aal2', officerIn.json)
const clinic = (await call('/rest/locations?select=id,name,slug&slug=eq.kkp18')).json?.[0]
check('anyone can look up the default clinic location (KK P18)', clinic?.name === 'Klinik Kesihatan Putrajaya P18', clinic)
const hpv = (await call('/rest/appointment_types?select=id,name_ms&code=eq.hpv')).json?.[0]
check('parents see the clinic types (Suntikan HPV)', hpv?.name_ms === 'Suntikan HPV', hpv)
const inThreeDays = new Date(Date.now() + 3 * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
const added = await call('/rest/rpc/add_slots', {
  method: 'POST',
  token: officerIn.json.access_token,
  body: { p_location: clinic?.id, p_type: hpv?.id, p_date: inThreeDays, p_start: '09:00', p_end: '09:30', p_minutes: 15, p_capacity: 1 },
})
check('officer adds slots at the clinic', added.status === 200 && added.json === 2, added)
const listed = await call('/rest/rpc/admin_officers', { method: 'POST', token: adminIn.json.access_token, body: {} })
const mine = Array.isArray(listed.json) ? listed.json.find((o) => o.email === staffEmail) : null
check('admin sees the officer, registered, running slots at KK P18',
  mine?.registered === true && mine?.locations?.[0]?.name === clinic?.name, listed.json)
// Removing a location cancels its bookings and emails the parent, end to end:
// database outbox -> sign-in service (LISTEN) -> SMTP (Mailpit).
const bookerEmail = `booker.${Date.now()}@test.local`
const booker = await staffSignIn(bookerEmail)
const bt = booker.json.access_token
const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')
const dd = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')
// Test-only MyKid: born 2014, place code 10, even last digit = female. Random so reruns never collide.
const testMykid = `14${mm}${dd}10${String(Math.floor(Math.random() * 5000) * 2).padStart(4, '0')}`
const reg = await call('/rest/rpc/register_child', {
  method: 'POST',
  token: bt,
  body: { p_school_id: schools.json[0].id, p_full_name: 'Anak Semakan', p_mykid: testMykid, p_dob: `2014-${mm}-${dd}`,
          p_gender: 'female', p_class_name: '5A', p_relationship: 'mother', p_consent: true },
})
const childId = (await call('/rest/students?select=id', { token: bt })).json?.[0]?.id
check('a parent registers a child at any school', reg.status === 200 && !!childId, reg)
const placeName = `Klinik Semakan ${Date.now()}`
const place = await call('/rest/rpc/add_location', { method: 'POST', token: officerIn.json.access_token, body: { p_name: placeName, p_address: null } })
await call('/rest/rpc/add_slots', {
  method: 'POST',
  token: officerIn.json.access_token,
  body: { p_location: place.json?.id, p_type: hpv?.id, p_date: inThreeDays, p_start: '10:00', p_end: '10:15', p_minutes: 15, p_capacity: 1 },
})
const open = await call('/rest/rpc/available_slots', { method: 'POST', token: bt, body: { p_student: childId } })
const slot = Array.isArray(open.json) ? open.json.find((x) => x.location_id === place.json?.id) : null
const booking = await call('/rest/rpc/book_slot', { method: 'POST', token: bt, body: { p_slot: slot?.id, p_student: childId, p_type: hpv?.id, p_note: null } })
check('the parent books an HPV slot at the new location', booking.status === 200, booking)
const removed = await call('/rest/rpc/remove_location', { method: 'POST', token: officerIn.json.access_token, body: { p_location: place.json?.id } })
check('the officer removes the location: the booking is cancelled', removed.json?.cancelled === 1, removed)
let cancelMail = null
for (let i = 0; i < 40 && !cancelMail; i++) {
  const found = await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${bookerEmail} subject:"Temujanji dibatalkan"`)}`)).json()
  if (found.messages?.length) cancelMail = (await (await fetch(`http://127.0.0.1:8025/api/v1/message/${found.messages[0].ID}`)).json()).Text
  else await new Promise((r) => setTimeout(r, 250))
}
check('the parent gets the cancellation email within seconds, with a link to book again',
  !!cancelMail && cancelMail.includes('Suntikan HPV untuk Anak Semakan') && cancelMail.includes(placeName) && cancelMail.includes('/vaksin-app/#/book'),
  cancelMail?.slice(0, 200))
const kkp18Gone = await call('/rest/rpc/remove_location', { method: 'POST', token: officerIn.json.access_token, body: { p_location: clinic?.id } })
check('the default clinic cannot be removed', JSON.stringify(kkp18Gone.json).includes('location_default'), kkp18Gone)

const asOfficer = await call('/rest/rpc/admin_officers', { method: 'POST', token: officerIn.json.access_token, body: {} })
check('an officer cannot see the officer list', asOfficer.status >= 400, asOfficer.status)

// Leave the dev database as it was: test accounts, their audit entries and this run's
// rate-limit counters go, so running the checks many times an hour never trips a limit.
const testEmails = [parentEmail, spoofEmail, staffEmail, adminEmail, bookerEmail].map((e) => `'${e}'`).join(', ')
psql(`delete from public.appointments where booked_by in (select id from auth.users where email in (${testEmails}));
      delete from public.students where id in (select student_id from public.student_guardians
         where guardian_id in (select id from auth.users where email in (${testEmails})));
      delete from notify.email_outbox where to_email in (${testEmails});
      delete from public.slots where officer_id in (select id from auth.users where email in (${testEmails}));
      delete from public.audit_log where actor_id in (select id from auth.users where email in (${testEmails}))
         or entity_id in (select id from auth.users where email in (${testEmails}));
      delete from auth.users where email in (${testEmails});
      delete from public.locations where name like 'Klinik Semakan %';
      delete from auth_private.rate_events where created_at >= '${startedAt}'`)

console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
