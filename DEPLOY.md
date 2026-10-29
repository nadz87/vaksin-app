# Going live

Vaksin App is two parts. The **website** (parents and officers) is static files on
GitHub Pages and is deployed by pushing to `main`. The **backend** (database, sign-in,
booking rules, audit log) is a Supabase project. The site shows "Sistem sedang
disediakan" until it is connected to one.

Website: https://nadz87.github.io/vaksin-app/

## 1. Create the Supabase project (once)

1. supabase.com, New project. Region **Southeast Asia (Singapore)**. Save the database
   password in a password manager.
2. From this folder:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push        # applies every migration: tables, security rules, functions,
                               # appointment types and the Putrajaya school list
   ```

   `supabase/seed.sql` is demo data for local development only and is not pushed.

## 2. Sign-in settings (Supabase dashboard, Authentication)

- **URL configuration**: Site URL `https://nadz87.github.io/vaksin-app/`, and add the same
  address under Redirect URLs.
- **Email**: code length 6, expiry 600 seconds. Put the content of
  `supabase/templates/otp_code.html` in both the "Confirm signup" and "Magic link"
  templates, with the subject `Kod log masuk Vaksin App / Vaksin App sign-in code`.
- **SMTP**: turn on custom SMTP (for example Resend with a verified sender such as
  `no-reply@imotion.my`). Supabase's built-in email is limited to a few messages an hour
  and is only for testing.
- **Multi-factor**: enable TOTP (enrol and verify). Officers and admins must use it.

## 3. Connect the website to the project

The two values below are safe to publish (the anon key is public by design; the database
rules protect the data). Never use the `service_role` key here.

```bash
gh variable set VITE_SUPABASE_URL --body "https://<your-project-ref>.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "<anon or publishable key>"
gh workflow run "Build and deploy to GitHub Pages"
```

## 4. First accounts

1. Dashboard, Authentication, Users, **Add user** for the platform admin: email + password,
   auto-confirm. Then in the SQL editor:

   ```sql
   update public.profiles set role = 'platform_admin' where email = 'you@example.com';
   ```

2. Add each health officer the same way (email + password), then run
   `update public.profiles set role = 'officer' where email = '...';`
3. Open `#/admin`, sign in, set up the authenticator app, and use **assign officer** to give
   each officer their schools. Officers sign in at `#/officer`.
4. Parents just open their school's link, `#/s/<school-slug>`, for example
   `https://nadz87.github.io/vaksin-app/#/s/sk-putrajaya-presint-8-1`, and sign in with an
   email code.

## 5. Before real student data goes in

- Make the repository **private**. On GitHub Free, Pages stops working for private
  repositories, so upgrade first (GitHub Pro) or move hosting.
- GitHub's terms do not allow Pages for a paid, commercial service. Move the website to
  a normal web host or Cloudflare Pages before the first paying school.
- Use a paid Supabase plan so backups are on.
- Remove `<meta name="robots" content="noindex">` from `index.html` at launch.
- Check the privacy wording and how long records are kept with the school (PDPA).
