-- Vaksin App: what a Supabase project provides before our migrations run, for plain Postgres.
-- Applied once by server/migrate.mjs, before supabase/migrations/. Never pushed to Supabase
-- (it already has all of this), so `npx supabase start` keeps working during the switch.
--
-- The sign-in service's own tables (codes, 2FA secrets, sessions) come in Phase B.

create schema if not exists extensions;
create schema if not exists auth;

-- pgTAP and btree_gist live in `extensions`, and the tests call pgTAP unqualified,
-- the same search path Supabase sets.
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
set search_path = "$user", public, extensions;

-- Roles. PostgREST signs in as `authenticator` and switches to `anon` (no token) or
-- `authenticated` (valid token) for each request. Roles are shared by every database on
-- the server, so create them only once.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    -- Password is set by migrate.mjs from AUTHENTICATOR_PASSWORD.
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated to authenticator;

-- Accounts. Only the columns this app uses; the sign-in service fills them.
create table if not exists auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  password_hash   text,            -- staff only (scrypt); parents sign in with email codes
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz,
  disabled_at     timestamptz
);
create unique index if not exists users_email_key on auth.users (lower(email));

-- The signed-in user, read from the token PostgREST checked. Same contract as Supabase:
-- PostgREST puts the token's claims in `request.jwt.claims` for the transaction.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema auth, extensions to anon, authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
revoke all on auth.users from anon, authenticated;

-- Supabase grants every new table, sequence and function in `public` to anon and
-- authenticated, and relies on row-level security to decide what each one sees.
-- Copied as is so the migrations and tests mean the same thing here.
-- Follow-up (VPS-BACKEND-PLAN.md section 6): replace with explicit per-table grants.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
