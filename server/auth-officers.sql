-- Vaksin App: health officer invitations, sent by the sign-in service (POST /auth/invite).
-- Applied by server/migrate.mjs after auth-schema.sql: it needs public.profiles and the
-- vaksin_auth role. The service checks the admin's 2-step session; this function checks
-- again that the actor really is a platform admin.

create or replace function auth_private.invite_officer(p_actor uuid, p_email text)
returns table (user_id uuid, already_registered boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user  uuid;
  v_seen  timestamptz;
  v_role  public.user_role;
begin
  if not exists (select 1 from public.profiles where user_id = p_actor and role = 'platform_admin') then
    raise exception 'not_allowed';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;

  select id, last_sign_in_at into v_user, v_seen from auth.users where lower(email) = v_email;
  if v_user is null then
    insert into auth.users (email) values (v_email) returning id into v_user; -- trigger adds the profile
  end if;

  select role into v_role from public.profiles where user_id = v_user;
  if v_role = 'platform_admin' then
    raise exception 'already_admin';
  end if;
  if v_role = 'parent' and exists (select 1 from public.student_guardians where guardian_id = v_user) then
    raise exception 'email_is_parent';
  end if;

  update public.profiles set role = 'officer' where user_id = v_user and role <> 'officer';
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, 'invite_officer', 'profile', v_user, jsonb_build_object('email', v_email));
  return query select v_user, v_seen is not null;
end $$;

revoke all on function auth_private.invite_officer(uuid, text) from public;
grant execute on function auth_private.invite_officer(uuid, text) to vaksin_auth;
