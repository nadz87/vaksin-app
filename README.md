# Vaksin App

School health appointments: parents book, the health officer manages
availability across several schools. Browser-first web app (no install),
hosted on GitHub Pages, backend on Supabase.

- Live site: https://nadz87.github.io/vaksin-app/
- Going live and first accounts: [DEPLOY.md](DEPLOY.md)

## Local development

Needs Node 24 and Docker Desktop running.

```bash
npm install
npx supabase start          # local database, auth and test mailbox
npx supabase status -o env  # copy API_URL and ANON_KEY into .env.local (see .env.example)
npm run dev                 # http://localhost:5173/vaksin-app/
```

- Test mailbox (sign-in codes): http://127.0.0.1:54324
- Demo school links: `#/s/sk-taman-demo`, `#/s/smk-bukit-contoh`
- Officer area: `#/officer` · Platform admin: `#/admin`
- Test staff accounts (local database only): `node scripts/create-local-staff.mjs`
  creates `pegawai@test.local` (officer) and `admin@test.local` (admin). Both
  must set up an authenticator app on first sign-in.

## Tests

```bash
npm test             # unit tests (MyKid parsing)
npx supabase test db # database security rules (pgTAP)
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

## Making the first platform admin

1. Sign in once with the admin's email (parent sign-in creates the account).
2. In the Supabase SQL editor:
   `update profiles set role = 'platform_admin' where email = 'you@example.com';`
3. Set a password for that user in Supabase Auth, then sign in at `#/admin`
   and set up the authenticator app.

Officers: invite the user from Supabase Auth (they set a password), then
assign them to a school from `#/admin`.

## Deploy

Push to `main` runs `.github/workflows/deploy.yml`: safety check (no
spreadsheets/CSV/env files), unit tests, build, deploy to Pages. Set repo
Actions **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`;
without them the site shows "System is being set up".

Rules: never commit real student data or exports. Before real data, make
the repo private (needs GitHub Pro for Pages) and move hosting off Pages
before the first paying school (see PLAN.md 3a).
