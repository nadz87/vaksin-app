// Applies the database setup to a plain Postgres server (no Supabase):
//   1. server/platform.sql   (roles, auth schema, auth.uid(): what Supabase used to provide)
//   2. supabase/migrations/*.sql in name order
//   3. server/auth-schema.sql (sign-in service tables and role; needs public.profiles)
//   4. supabase/seed.sql      only with --seed (demo data, local development only)
// Each file runs in its own transaction and is recorded in migrations.applied with a
// checksum, so running it again only applies new files. An applied file that was edited
// later stops the run (set ALLOW_CHANGED_MIGRATIONS=1 locally to only warn).
//
// Usage: DATABASE_URL=postgres://postgres:...@127.0.0.1:55432/vaksin \
//        AUTHENTICATOR_PASSWORD=... AUTH_DB_PASSWORD=... node server/migrate.mjs [--seed]
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = fileURLToPath(new URL('..', import.meta.url))
const MIGRATIONS = `${root}supabase/migrations/`

/**
 * Decides what to do when a file that was already applied has been edited since.
 * `name` is the file name, `applied` / `current` are its two checksums.
 * Return nothing to carry on, or throw to stop the run.
 */
function onChangedMigration(name, applied, current) {
  const detail = `${name} was edited after it was applied (applied ${applied}, file now ${current}).`
  // Local experiments may opt in; production never sets this, so it stops there.
  if (process.env.ALLOW_CHANGED_MIGRATIONS === '1') {
    console.warn(`warning: ${detail} The database still has the old version.`)
    return
  }
  throw new Error(`${detail} Put the change in a new migration file instead.`)
}

// Line endings are ignored: a Windows checkout (CRLF) is the same file as the LF original.
function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
}

async function applyFile(client, name, sql, done) {
  const sum = checksum(sql)
  if (done.has(name)) {
    if (done.get(name) !== sum) onChangedMigration(name, done.get(name), sum)
    return false
  }
  await client.query('begin')
  try {
    await client.query(sql)
    await client.query('insert into migrations.applied (name, checksum) values ($1, $2)', [name, sum])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw new Error(`${name}: ${error.message}`)
  }
  return true
}

// format(%L) quotes the password safely; utility statements cannot take $1 parameters.
async function setPassword(client, role, password) {
  const { rows } = await client.query("select format('alter role %I password %L', $1::text, $2::text) as sql", [role, password])
  await client.query(rows[0].sql)
}

export async function migrate({ url, authenticatorPassword, authDbPassword, seed = false, log = console.log }) {
  if (!authenticatorPassword) throw new Error('AUTHENTICATOR_PASSWORD is required')
  if (!authDbPassword) throw new Error('AUTH_DB_PASSWORD is required')

  // The bookkeeping table lives outside `public`, so PostgREST never exposes it.
  let client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query(`create schema if not exists migrations;
    create table if not exists migrations.applied (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`)
  const done = new Map((await client.query('select name, checksum from migrations.applied')).rows.map((r) => [r.name, r.checksum]))

  const platform = readFileSync(`${root}server/platform.sql`, 'utf8')
  if (await applyFile(client, 'platform.sql', platform, done)) log('applied platform.sql')
  await setPassword(client, 'authenticator', authenticatorPassword)

  // Reconnect so the search path platform.sql set on the database is in effect.
  await client.end()
  client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    let count = 0
    for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      if (await applyFile(client, name, readFileSync(MIGRATIONS + name, 'utf8'), done)) {
        log(`applied ${name}`)
        count++
      }
    }
    if (await applyFile(client, 'auth-schema.sql', readFileSync(`${root}server/auth-schema.sql`, 'utf8'), done)) {
      log('applied auth-schema.sql')
    }
    await setPassword(client, 'vaksin_auth', authDbPassword)
    if (seed && (await applyFile(client, 'seed.sql', readFileSync(`${root}supabase/seed.sql`, 'utf8'), done))) {
      log('applied seed.sql')
    }
    // A running PostgREST reloads its view of tables and functions when it hears this.
    await client.query("notify pgrst, 'reload schema'")
    log(count ? `${count} migration(s) applied.` : 'Database is up to date.')
  } finally {
    await client.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  migrate({
    url,
    authenticatorPassword: process.env.AUTHENTICATOR_PASSWORD,
    authDbPassword: process.env.AUTH_DB_PASSWORD,
    seed: process.argv.includes('--seed') }).catch(
    (error) => {
      console.error(error.message)
      process.exit(1)
    },
  )
}
