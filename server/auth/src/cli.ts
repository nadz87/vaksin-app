// Staff accounts, run on the server only (replaces "Add user" in the Supabase dashboard):
//   node src/cli.ts create-staff --email a@b.my --role officer|platform_admin [--name "Nama"]
//   node src/cli.ts reset-mfa   --email a@b.my     (lost phone: set up the app again)
//   node src/cli.ts disable     --email a@b.my     (signs out everywhere, blocks sign-in)
//   node src/cli.ts enable      --email a@b.my
// create-staff prints a temporary password once; the officer must change it on first sign-in.
import pg from 'pg'
import { hashPassword, newTemporaryPassword } from './secrets.ts'
import { revokeSessions } from './sessions.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const command = process.argv[2]
const email = arg('email')?.trim().toLowerCase()
if (!command || !email) {
  console.error('Usage: node src/cli.ts create-staff|reset-mfa|disable|enable --email <email> [--role officer|platform_admin] [--name <name>]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
try {
  if (command === 'create-staff') {
    const role = arg('role')
    if (role !== 'officer' && role !== 'platform_admin') throw new Error('--role must be officer or platform_admin')
    const password = newTemporaryPassword()
    const { rows } = await db.query(
      `insert into auth.users (email, password_hash, must_change_password) values ($1, $2, true)
       on conflict (lower(email)) do update set password_hash = excluded.password_hash, must_change_password = true
       returning id`,
      [email, await hashPassword(password)],
    )
    await db.query('select auth_private.set_staff_role($1, $2, $3)', [rows[0].id, role, arg('name') ?? null])
    await revokeSessions(db, rows[0].id)
    console.log(`${email} is now ${role}.`)
    console.log(`Temporary password (shown once, give it to them privately): ${password}`)
    console.log('They sign in, change the password, then set up the authenticator app.')
  } else {
    const { rows } = await db.query('select id from auth.users where lower(email) = $1', [email])
    if (!rows[0]) throw new Error(`No account for ${email}`)
    const id = rows[0].id
    if (command === 'reset-mfa') {
      await db.query('delete from auth_private.mfa_factors where user_id = $1', [id])
      await revokeSessions(db, id)
      console.log(`${email}: authenticator removed and signed out; they set it up again at next sign-in.`)
    } else if (command === 'disable') {
      await db.query('update auth.users set disabled_at = now() where id = $1', [id])
      await revokeSessions(db, id)
      console.log(`${email}: disabled and signed out everywhere.`)
    } else if (command === 'enable') {
      await db.query('update auth.users set disabled_at = null where id = $1', [id])
      console.log(`${email}: enabled.`)
    } else {
      throw new Error(`Unknown command ${command}`)
    }
  }
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await db.end()
}
