// Creates test staff accounts in your LOCAL Supabase only (officer + platform admin).
// Usage:  node scripts/create-local-staff.mjs   (needs `npx supabase start` running)
// The password comes from LOCAL_STAFF_PASSWORD in your git-ignored .env.local (it is
// generated and saved there the first time), so no password is stored in the repository.
// The script refuses to run against anything that is not 127.0.0.1 / localhost.
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  console.error(`Refusing to run against ${API}: local Supabase only.`)
  process.exit(1)
}

const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const KEY = env.SERVICE_ROLE_KEY
if (!KEY) throw new Error('SERVICE_ROLE_KEY not found; is local Supabase running?')

function localPassword() {
  const file = '.env.local'
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const found = text.match(/^LOCAL_STAFF_PASSWORD=(.+)$/m)
  if (found) return found[1].trim()
  const made = randomBytes(15).toString('base64url')
  const lead = text === '' || text.endsWith('\n') ? '' : '\n'
  appendFileSync(file, `${lead}LOCAL_STAFF_PASSWORD=${made}\n`)
  return made
}
const PASSWORD = process.env.LOCAL_STAFF_PASSWORD ?? localPassword()
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function ensureUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (res.ok) return body.id
  // Already exists: look it up.
  const list = await (await fetch(`${API}/auth/v1/admin/users?per_page=200`, { headers })).json()
  const found = list.users.find((u) => u.email === email)
  if (!found) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`)
  await fetch(`${API}/auth/v1/admin/users/${found.id}`, { method: 'PUT', headers, body: JSON.stringify({ password: PASSWORD }) })
  return found.id
}

async function rest(path, method, body) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
}

const officer = await ensureUser('pegawai@test.local')
const admin = await ensureUser('admin@test.local')

await rest(`profiles?user_id=eq.${officer}`, 'PATCH', { role: 'officer', full_name: 'Pegawai Kesihatan Ujian' })
await rest(`profiles?user_id=eq.${admin}`, 'PATCH', { role: 'platform_admin', full_name: 'Admin iMotion Ujian' })

// The local test officer serves every school, like the demo officer in seed.sql.
const schools = await (await fetch(`${API}/rest/v1/schools?select=id,slug`, { headers })).json()
await rest('officer_schools', 'POST', schools.map((s) => ({ officer_id: officer, school_id: s.id })))

console.log('Local staff ready: pegawai@test.local (officer), admin@test.local (platform admin).')
console.log('Password: LOCAL_STAFF_PASSWORD in your .env.local. Both need an authenticator app on first sign-in at #/officer or #/admin.')
