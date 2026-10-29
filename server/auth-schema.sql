-- Vaksin App: tables and database role for our own sign-in service (server/auth).
-- Applied by server/migrate.mjs after platform.sql, before supabase/migrations/.
--
-- Everything here lives in `auth` / `auth_private`, which PostgREST does not expose. The
-- service signs in as `vaksin_auth`, which can manage accounts and sessions but cannot
-- read children, MyKid numbers or appointments.

create schema if not exists auth_private;

alter table auth.users add column if not exists must_change_password boolean not null default false;

-- One row per email code sent. Only a hash of the code is kept.
create table if not exists auth_private.email_codes (
  id         bigint generated always as identity primary key,
  email      text not null,
  code_hash  text not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists email_codes_email on auth_private.email_codes (lower(email), created_at desc);

-- Staff authenticator app (TOTP). The secret is encrypted by the service (AES-256-GCM).
create table if not exists auth_private.mfa_factors (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  secret_enc     bytea not null,
  verified_at    timestamptz,
  last_used_step bigint not null default 0,   -- stops the same 6-digit code being used twice
  created_at     timestamptz not null default now()
);

-- A signed-in device. aal2 once the staff member passed the authenticator check.
create table if not exists auth_private.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  aal         text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text
);
create index if not exists sessions_user on auth_private.sessions (user_id);

-- Refresh tokens, hashed. Each is used once; using one again ends the session.
create table if not exists auth_private.refresh_tokens (
  token_hash text primary key,
  session_id uuid not null references auth_private.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists refresh_tokens_session on auth_private.refresh_tokens (session_id);

-- Counters for rate limits and lockouts, e.g. key 'start:email:a@b.c' or 'pwfail:a@b.c'.
create table if not exists auth_private.rate_events (
  key        text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_key on auth_private.rate_events (key, created_at);

-- The service's role. Password is set by migrate.mjs from AUTH_DB_PASSWORD.
do $$
begin
  if not exists (select from pg_roles where rolname = 'vaksin_auth') then
    create role vaksin_auth login noinherit;
  end if;
end $$;

grant usage on schema auth, auth_private to vaksin_auth;
grant select, insert, update on auth.users to vaksin_auth;
grant select, insert, update, delete on all tables in schema auth_private to vaksin_auth;
grant usage on all sequences in schema auth_private to vaksin_auth;
revoke all on schema auth_private from anon, authenticated;

-- The service needs to know who is staff, and the admin tool must set roles, without
-- reading profiles (names, phones, addresses) directly. These two functions are all it gets.
create or replace function auth_private.user_role(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role::text from public.profiles where user_id = p_user
$$;

create or replace function auth_private.set_staff_role(p_user uuid, p_role text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('officer', 'platform_admin') then
    raise exception 'bad_role';
  end if;
  update public.profiles
     set role = p_role::public.user_role, full_name = coalesce(p_name, full_name)
   where user_id = p_user;
  if not found then
    raise exception 'profile_not_found';
  end if;
end $$;

revoke all on function auth_private.user_role(uuid), auth_private.set_staff_role(uuid, text, text) from public;
grant execute on function auth_private.user_role(uuid), auth_private.set_staff_role(uuid, text, text) to vaksin_auth;
