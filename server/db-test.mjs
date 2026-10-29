// Runs the pgTAP suite (supabase/tests) on plain Postgres: a fresh `vaksin_test` database
// gets platform.sql + every migration, then pg_prove runs inside the db container.
// Needs `npm run api:up` first. The development database `vaksin` is not touched.
import pg from 'pg'
import { compose, dbUrl, devEnv } from './dev.mjs'
import { migrate } from './migrate.mjs'

const env = devEnv()
const admin = new pg.Client({ connectionString: dbUrl(env, 'postgres') })
await admin.connect()
await admin.query('drop database if exists vaksin_test with (force)')
await admin.query('create database vaksin_test')
await admin.end()

await migrate({
  url: dbUrl(env, 'vaksin_test'),
  authenticatorPassword: env.AUTHENTICATOR_PASSWORD,
  authDbPassword: env.AUTH_DB_PASSWORD,
  log: () => {},
})
try {
  compose('exec', '-T', 'db', 'pg_prove', '-U', 'postgres', '-d', 'vaksin_test', '--ext', '.sql', '-r', '/tests')
} catch {
  process.exit(1)
}
