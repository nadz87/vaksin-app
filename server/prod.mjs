// Production tasks for the Vaksin App backend on the iMotion office PC.
//   node server/prod.mjs init             create D:\VPS\vaksin\ and its .env (random secrets)
//   node server/prod.mjs backup-key       make the backup key pair (public key into .env)
//   node server/prod.mjs up               apply migrations, then start/update every service
//   node server/prod.mjs status           containers and health
//   node server/prod.mjs backup-now       one backup straight away
//   node server/prod.mjs restore-test <private-key-file>   prove the newest backup restores
//   node server/prod.mjs staff <create-staff|reset-mfa|disable|enable> --email ... [--role ...]
//   node server/prod.mjs down             stop (data is kept)
// Secrets live only in <dir>\.env, outside the repository. Set VAKSIN_PROD_DIR to use
// another folder.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from './migrate.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const DIR = process.env.VAKSIN_PROD_DIR ?? 'D:\\VPS\\vaksin'
const ENV_FILE = join(DIR, '.env')
const BACKUP_DIR = join(DIR, 'backups')

const SECRETS = ['DB_PASSWORD', 'AUTHENTICATOR_PASSWORD', 'AUTH_DB_PASSWORD', 'JWT_SECRET', 'OTP_PEPPER', 'TOTP_ENC_KEY']
const SETTINGS = `
# Email for sign-in codes (Brevo SMTP relay). Fill in SMTP_USER (the Brevo login) and
# SMTP_PASS (an SMTP key from Brevo > SMTP & API). Until then codes cannot be sent.
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Vaksin App <no-reply@imotion.my>

# Website address allowed to call the API.
CORS_ORIGIN=https://nadz87.github.io

# Backups. AGE_RECIPIENT is filled by \`node server/prod.mjs backup-key\`.
# R2: bucket name, Cloudflare account id, and an R2 API token limited to that bucket.
AGE_RECIPIENT=
R2_BUCKET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
`

function readEnv() {
  if (!existsSync(ENV_FILE)) return {}
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  )
}

function init() {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const env = readEnv()
  const missing = SECRETS.filter((k) => !env[k])
  if (!existsSync(ENV_FILE)) {
    writeFileSync(
      ENV_FILE,
      '# Vaksin App production secrets. Never commit, never send by chat or email.\n' +
        '# Back this file up somewhere safe: without it the database and 2-step secrets are unreadable.\n',
    )
  }
  if (missing.length) {
    const text = readFileSync(ENV_FILE, 'utf8')
    appendFileSync(ENV_FILE, (text.endsWith('\n') ? '' : '\n') + missing.map((k) => `${k}=${randomBytes(32).toString('hex')}\n`).join(''))
  }
  if (!('SMTP_HOST' in readEnv())) appendFileSync(ENV_FILE, SETTINGS)
  console.log(`${ENV_FILE} ready (${missing.length} new secret(s); existing values kept).`)
}

function need() {
  if (!existsSync(ENV_FILE)) {
    console.error(`No ${ENV_FILE} yet. Run: node server/prod.mjs init`)
    process.exit(1)
  }
  return readEnv()
}

function compose(...args) {
  execFileSync('docker', ['compose', '-f', join(here, 'compose.prod.yml'), '--env-file', ENV_FILE, ...args], {
    stdio: 'inherit',
    env: { ...process.env, BACKUP_DIR },
  })
}

async function up() {
  const env = need()
  compose('up', '-d', '--build', '--wait', 'db')
  await migrate({
    url: `postgres://postgres:${env.DB_PASSWORD}@127.0.0.1:55433/vaksin`,
    authenticatorPassword: env.AUTHENTICATOR_PASSWORD,
    authDbPassword: env.AUTH_DB_PASSWORD,
  })
  compose('up', '-d', '--build', '--wait', '--remove-orphans')
  status()
}

function status() {
  compose('ps', '--format', 'table {{.Service}}\t{{.Status}}')
  for (const path of ['/auth/health', '/rest/rpc/list_schools']) {
    const method = path.startsWith('/rest') ? 'POST' : 'GET'
    fetch(`http://127.0.0.1:4010${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      .then((r) => console.log(`${path}: ${r.status}`))
      .catch((e) => console.log(`${path}: not reachable (${e.cause?.code ?? e.message})`))
  }
  const env = readEnv()
  if (!env.SMTP_PASS) console.log('Note: SMTP_PASS is empty, sign-in codes cannot be emailed yet.')
  if (!env.AGE_RECIPIENT) console.log('Note: no backup key yet (node server/prod.mjs backup-key).')
  if (!env.R2_BUCKET) console.log('Note: R2 is not set up, backups stay on this PC only.')
}

function backupKey() {
  const env = need()
  if (env.AGE_RECIPIENT) {
    console.log('A backup key already exists (AGE_RECIPIENT is set). Not replacing it.')
    return
  }
  const keyFile = join(DIR, 'BACKUP-PRIVATE-KEY.txt')
  if (existsSync(keyFile)) throw new Error(`${keyFile} exists; move it somewhere safe or delete it first`)
  const out = execFileSync('docker', ['run', '--rm', '--entrypoint', 'age-keygen', 'vaksin-backup:prod'], { encoding: 'utf8' })
  const publicKey = out.match(/public key: (age1\S+)/)?.[1]
  if (!publicKey) throw new Error('age-keygen gave no public key')
  writeFileSync(keyFile, out)
  const text = readFileSync(ENV_FILE, 'utf8').replace(/^AGE_RECIPIENT=.*$/m, `AGE_RECIPIENT=${publicKey}`)
  writeFileSync(ENV_FILE, text)
  compose('up', '-d', 'backup') // restart it with the new public key
  console.log(`Public key saved in .env. Private key written to ${keyFile}`)
  console.log('MOVE that file off this PC now (password manager or a USB stick kept elsewhere),')
  console.log('then delete it here. Without it no backup can be read; with it anyone can read them.')
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'init') init()
else if (command === 'up') await up()
else if (command === 'status') (need(), status())
else if (command === 'down') (need(), compose('down'))
else if (command === 'backup-key') backupKey()
else if (command === 'backup-now') (need(), compose('exec', 'backup', 'backup.sh'))
else if (command === 'restore-test') {
  need()
  if (!rest[0] || !existsSync(rest[0])) throw new Error('Usage: node server/prod.mjs restore-test <private-key-file>')
  const result = spawnSync('docker', ['compose', '-f', join(here, 'compose.prod.yml'), '--env-file', ENV_FILE, 'exec', '-T', 'backup', 'restore-test.sh'], {
    input: readFileSync(rest[0]),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, BACKUP_DIR },
  })
  process.exitCode = result.status ?? 1
} else if (command === 'staff') {
  need()
  compose('exec', 'auth', 'node', 'src/cli.ts', ...rest)
} else {
  console.error('Usage: node server/prod.mjs init|up|status|down|backup-key|backup-now|restore-test <key>|staff ...')
  process.exitCode = 1
}
