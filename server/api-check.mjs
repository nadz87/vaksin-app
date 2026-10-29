// End-to-end checks of the local gateway + PostgREST: anonymous access, signed and forged
// tokens, 2FA rule, CORS. Needs `npm run api:up` first. Usage: npm run api:check
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const envFile = new URL('.env.dev', import.meta.url)
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const API = 'http://127.0.0.1:4011'
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
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, cors: res.headers.get('access-control-allow-origin') }
}

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(detail).slice(0, 200)}`}`)
  if (!ok) failed++
}

const schools = await call('/rest/rpc/list_schools', { method: 'POST', body: {} })
check('anon can list the 25 schools', schools.status === 200 && schools.json.length === 25, schools)

const kids = await call('/rest/students?select=id')
check('anon sees no students (row-level security)', kids.status === 200 && kids.json.length === 0, kids)
const ids = await call('/rest/student_identifiers?select=*')
check('anon sees no MyKid numbers', ids.status === 200 && ids.json.length === 0, ids)
for (const path of ['/rest/users', '/rest/applied', '/rest/'])
  check(`not exposed: ${path}`, [404, 400, 401, 403].includes((await call(path)).status) && !(Array.isArray((await call(path)).json)), path)

const good2 = jwt({ sub: OFFICER, aal: 'aal2' })
const me = await call(`/rest/profiles?select=role&user_id=eq.${OFFICER}`, { token: good2 })
check('signed token: officer reads own profile', me.status === 200 && me.json[0]?.role === 'officer', me)
const dash2 = await call('/rest/slots?select=id', { token: good2 })
check('officer with 2FA (aal2) sees own slots', dash2.status === 200 && dash2.json.length > 0, { status: dash2.status, n: dash2.json.length })
const dash1 = await call('/rest/slots?select=id', { token: jwt({ sub: OFFICER, aal: 'aal1' }) })
check('officer without 2FA (aal1) sees no slots', dash1.status === 200 && dash1.json.length === 0, dash1)

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
const auth = await call('/auth/health')
check('/auth/ answers 503 until Phase B', auth.status === 503, auth)

console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
