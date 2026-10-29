# Going live

Vaksin App is two parts. The **website** (parents and officers) is static files on
GitHub Pages and is deployed by pushing to `main`. The **backend** (Postgres, the
PostgREST database API, our own sign-in service and an nginx gateway) runs in Docker on
the iMotion server behind the Cloudflare Tunnel. The site shows "Sistem sedang
disediakan" until it is built with the backend's address.

Website: https://nadz87.github.io/vaksin-app/

Status: the backend works locally (see README, `npm run api:up`). The production
server set-up (compose file, secrets, tunnel hostname, email, backups) is the next step
and will be written here when it is done. Supabase is no longer used.

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
