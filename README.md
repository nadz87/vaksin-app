# Vaksin App

School health appointments: parents book, the health officer manages
availability across several schools. Browser-first web app (no install),
hosted on GitHub Pages; the backend (Postgres, PostgREST and our own sign-in
service) runs in Docker on the iMotion server.

- Live site: https://nadz87.github.io/vaksin-app/
- Going live and first accounts: [DEPLOY.md](DEPLOY.md)

## Local development

Needs Node 24 and Docker Desktop running.

```bash
npm install
npm --prefix server/auth install
npm run api:up      # database, database API, sign-in service, test inbox, gateway
npm run dev         # http://localhost:5173/vaksin-app/
```

Put `VITE_API_URL=http://127.0.0.1:4011` in `.env.local` (see `.env.example`).
`npm run api:up` creates `server/.env.dev` with random local secrets the first
time, applies every migration and the demo data. `npm run api:down` stops it;
the data is kept.

- Test inbox (sign-in codes): http://127.0.0.1:8025 (no email leaves this PC)
- Demo school link: `#/s/sk-putrajaya-presint-8-1`
- Officer area: `#/officer` · Platform admin: `#/admin`
- Staff have no passwords: they sign in with an emailed code, then an authenticator app.
  The platform admin is made once on the server with the sign-in service's CLI:

  ```bash
  docker exec vaksin-dev-auth-1 node src/cli.ts create-staff --email admin.demo@test.local --role platform_admin
  ```

  The admin invites health officers by email at `#/admin`. Officers sign in at `#/officer`,
  complete their profile and choose their own schools (Tetapan, Sekolah). The demo officer
  in the seed data already serves every school.
  Other CLI commands: `reset-mfa`, `disable`, `enable` (see `server/auth/src/cli.ts`).

## Tests

```bash
npm test               # website unit tests (MyKid parsing, phone numbers)
npm run api:db-test    # database security rules (pgTAP, 97 tests)
npm run api:auth-test  # sign-in service security tests
npm run api:check      # end to end through the gateway (needs api:up)
```

## Routes

| Route | Who |
|---|---|
| `#/s/<slug>` | School link / QR for parents (auto-joins the school) |
| `#/` | Parent home (or redirect for staff) |
| `#/join` | Pick a school by name |
| `#/children/new?school=<id>` | Add child profile |
| `#/officer` | Health officer: Utama, Kalendar (appointments + manage slots), Murid, Tetapan (school, schedule, closed days, Excel export); password + authenticator app |
| `#/officer/student/<id>` | Patient profile (logged) |
| `#/admin` | iMotion platform admin |

## Backend layout

| Path | What |
|---|---|
| `supabase/migrations/` | Tables, row-level security, booking rules (plain Postgres; the folder keeps its old name) |
| `server/platform.sql`, `server/auth-schema.sql` | Roles and sign-in tables that Supabase used to provide |
| `server/auth/` | Sign-in service: email codes, staff passwords, authenticator app, tokens |
| `server/gateway/` | nginx: `/rest/` to PostgREST, `/auth/` to the sign-in service, allowed origins |
| `server/compose.dev.yml` | Local stack (everything bound to 127.0.0.1) |

## Deploy

Push to `main` runs `.github/workflows/deploy.yml`: safety check (no
spreadsheets/CSV/env files), unit tests, build, deploy to Pages. Set the repo
Actions **variable** `VITE_API_URL` to the backend's address; without it the
site shows "System is being set up".

Rules: never commit real student data or exports. Before real data, make
the repo private (needs GitHub Pro for Pages) and move hosting off Pages
before the first paying school.
