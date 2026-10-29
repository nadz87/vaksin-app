# Going live

Vaksin App is two parts. The **website** (parents and officers) is static files on
GitHub Pages and is deployed by pushing to `main`. The **backend** (Postgres, the
PostgREST database API, our own sign-in service and an nginx gateway) runs in Docker on
the iMotion server behind the Cloudflare Tunnel. The site shows "Sistem sedang
disediakan" until it is built with the backend's address.

Website: https://nadz87.github.io/vaksin-app/

Supabase is no longer used.

## The production backend (iMotion office PC)

Everything runs from this repository with one script; secrets live only in
`D:\VPS\vaksin\.env` (outside the repository). Back that file up to a password manager:
without it the 2-step secrets and the database password are gone.

```bash
node server/prod.mjs init         # once: D:\VPS\vaksin\ and .env with random secrets
node server/prod.mjs up           # apply migrations, start or update every service
node server/prod.mjs status       # containers + health
node server/prod.mjs backup-key   # once: backup key pair (see Backups)
node server/prod.mjs backup-now   # one backup straight away
node server/prod.mjs staff create-staff --email ... --role officer|platform_admin
```

| Piece | Where |
|---|---|
| Public address | `https://vaksin.imotion.my` (Cloudflare Tunnel `vps-imotion` to `http://localhost:4010`) |
| Containers | Docker Compose project `vaksin`: db, rest, auth, gateway, backup (`server/compose.prod.yml`) |
| Open ports | `127.0.0.1:4010` gateway and `127.0.0.1:55433` database, this PC only |
| Secrets | `D:\VPS\vaksin\.env` |
| Local backups | `D:\VPS\vaksin\backups\` (7 days, encrypted) |

After changing `.env` (email or R2 settings), run `node server/prod.mjs up` again.
To update the backend after a `git pull`, also `node server/prod.mjs up`: migrations
run first, and an edited old migration stops it (put changes in a new file).

### Email (Brevo)

1. Brevo > Senders, Domains: add and verify `imotion.my` (it adds DKIM/DMARC records
   in Cloudflare DNS) and the sender `no-reply@imotion.my`.
2. Brevo > SMTP & API: create an SMTP key.
3. In `D:\VPS\vaksin\.env` set `SMTP_USER` (the SMTP login Brevo shows) and `SMTP_PASS`
   (the key). Then `node server/prod.mjs up`.

### Backups

- Every night at 02:00 the `backup` container dumps the database, encrypts it with the
  backup public key, keeps it 7 days in `D:\VPS\vaksin\backups\`, and copies it to R2
  (30 daily, 12 monthly).
- `backup-key` writes the private key once to `D:\VPS\vaksin\BACKUP-PRIVATE-KEY.txt`.
  Move it to a password manager or a USB stick kept elsewhere, then delete it from the PC.
  Without it no backup can be read; with it anyone can read them.
- R2: in Cloudflare create the bucket `vaksin-backups` and an R2 API token with Object
  Read & Write on that bucket only. Fill `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` in `.env`, run `up`, then `backup-now` and check the bucket.
- Monthly: `node server/prod.mjs restore-test <path-to-private-key>` restores the newest
  backup into a scratch database, counts the rows and removes it.
- Rebuilding on a new machine: run `init` with the old `.env` copied in, start only the
  database (`docker compose -f server/compose.prod.yml --env-file D:\VPS\vaksin\.env up -d db`),
  create the roles with `server/platform.sql` and `server/auth-schema.sql`'s role sections,
  `pg_restore` the decrypted dump into `vaksin`, then `node server/prod.mjs up`.

### Keeping it running (the PC is in the office)

- UPS for the PC and router; BIOS "restore on AC power loss: on".
- Windows Update active hours 06:30 to 18:30 on weekdays; power plan never sleeps.
- Docker Desktop starts at sign-in and Windows signs in after a restart, so the
  containers (all `restart: always`) come back by themselves.
- BitLocker on drive D:, recovery key kept outside the office. Locked room or cabinet.
- After restarting the Cloudflared service: `Restart-Service Cloudflared` in an
  administrator PowerShell, then check https://vaksin.imotion.my/auth/health shows `{"ok":true}`.

## Connect the website to the backend

The address is not a secret (the database rules and the sign-in service protect the data).

```bash
gh variable set VITE_API_URL --body "https://vaksin.imotion.my"
gh workflow run "Build and deploy to GitHub Pages"
```

## First accounts

On the server, the sign-in service's CLI creates staff accounts and prints a temporary
password once. Give it to the person privately.

```bash
node src/cli.ts create-staff --email admin@imotion.my --role platform_admin --name "Nama"
node src/cli.ts create-staff --email pegawai@example.my --role officer --name "Nama"
```

They sign in at `#/admin` or `#/officer`, change the password, and set up an
authenticator app. The admin then assigns each officer to schools at `#/admin`.
Lost phone: `reset-mfa --email ...`. Someone leaves: `disable --email ...`.

Parents just open their school's link, `#/s/<school-slug>`, for example
`https://nadz87.github.io/vaksin-app/#/s/sk-putrajaya-presint-8-1`, and sign in with an
email code.

## Before real student data goes in

- Make the repository **private**. On GitHub Free, Pages stops working for private
  repositories, so upgrade first (GitHub Pro) or move hosting.
- GitHub's terms do not allow Pages for a paid, commercial service. Move the website to
  `https://vaksin.imotion.my/` (same address as the backend) before the first paying school.
- Nightly encrypted off-site backups running, and one restore tested.
- Remove `<meta name="robots" content="noindex">` from `index.html` at launch.
- Check the privacy wording and how long records are kept with the school (PDPA).
