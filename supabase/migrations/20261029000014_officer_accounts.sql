-- Vaksin App: health officers. The platform admin invites them by email (the sign-in service
-- sends it, see server/auth-officers.sql) and sees their profiles on the admin page; officers
-- complete their own profile and choose the schools they serve.
-- Officers have no password: they sign in at #/officer with an emailed code, then the
-- authenticator app (aal2), which every staff page requires.
--
-- These functions touch auth.users and auth_private (made by server/auth-schema.sql, which
-- runs after the migrations), so they are plpgsql: the body is only checked when it runs.

alter table public.profiles add column job_title text
  check (job_title is null or length(job_title) <= 120);

-- Every invited officer: profile, schools, 2-step status. registered = has signed in.
create function public.admin_officers()
returns table (user_id uuid, email text, full_name text, phone text, job_title text, active boolean,
               registered boolean, two_step boolean, invited_at timestamptz, last_sign_in_at timestamptz,
               schools jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'not_allowed';
  end if;
  return query
  select p.user_id, p.email, p.full_name, p.phone, p.job_title, u.disabled_at is null,
         u.last_sign_in_at is not null,
         exists (select 1 from auth_private.mfa_factors f where f.user_id = p.user_id and f.verified_at is not null),
         u.created_at,
         u.last_sign_in_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
                     from public.officer_schools os join public.schools s on s.id = os.school_id
                    where os.officer_id = p.user_id), '[]'::jsonb)
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.role = 'officer'
   order by u.last_sign_in_at is null, p.full_name nulls last, p.email;
end $$;

-- Helper: the target must be an officer (never an admin or a parent).
create function public.require_officer(p_officer uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_officer and role = 'officer') then
    raise exception 'not_officer';
  end if;
end $$;

-- Officers choose the schools they serve themselves (the admin only sees the result).
create function public.officer_join_school(p_school uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2()
     or not exists (select 1 from public.profiles where user_id = auth.uid() and role = 'officer') then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.schools where id = p_school) then
    raise exception 'school_not_found';
  end if;
  insert into public.officer_schools (officer_id, school_id) values (auth.uid(), p_school)
  on conflict do nothing;
  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'officer_join_school', 'school', p_school, p_school);
end $$;

-- Leaving is refused while a child still has an upcoming appointment there. Otherwise the
-- officer's weekly schedule and closed days at that school go, unused future slots are
-- deleted and the rest blocked, so parents can never book a slot nobody will see.
create function public.officer_leave_school(p_school uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
begin
  if not public.has_aal2()
     or not exists (select 1 from public.profiles where user_id = v_me and role = 'officer') then
    raise exception 'not_allowed';
  end if;
  if exists (
    select 1 from public.appointments a join public.slots s on s.id = a.slot_id
     where s.officer_id = v_me and s.school_id = p_school and s.starts_at > now() and a.status = 'booked'
  ) then
    raise exception 'school_has_bookings';
  end if;

  delete from public.availability_rules where officer_id = v_me and school_id = p_school;
  delete from public.closures where officer_id = v_me and school_id = p_school;
  delete from public.slots s
   where s.officer_id = v_me and s.school_id = p_school and s.starts_at > now()
     and not exists (select 1 from public.appointments a where a.slot_id = s.id);
  update public.slots set status = 'blocked'
   where officer_id = v_me and school_id = p_school and starts_at > now();
  delete from public.officer_schools where officer_id = v_me and school_id = p_school;

  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (v_me, 'officer_leave_school', 'school', p_school, p_school);
end $$;

-- Disable (someone leaves: signed out everywhere, cannot sign in) or enable again.
create function public.admin_set_officer_active(p_officer uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_officer(p_officer);
  update auth.users set disabled_at = case when p_active then null else coalesce(disabled_at, now()) end
   where id = p_officer;
  if not p_active then
    update auth_private.sessions set revoked_at = now() where user_id = p_officer and revoked_at is null;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), case when p_active then 'enable_officer' else 'disable_officer' end, 'profile', p_officer);
end $$;

-- Lost phone: remove the authenticator; they scan a new QR code at their next sign-in.
create function public.admin_reset_officer_two_step(p_officer uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_officer(p_officer);
  delete from auth_private.mfa_factors where user_id = p_officer;
  update auth_private.sessions set revoked_at = now() where user_id = p_officer and revoked_at is null;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_two_step', 'profile', p_officer);
end $$;

revoke execute on function public.admin_officers() from public, anon;
revoke execute on function public.require_officer(uuid) from public, anon, authenticated;
revoke execute on function public.officer_join_school(uuid) from public, anon;
revoke execute on function public.officer_leave_school(uuid) from public, anon;
revoke execute on function public.admin_set_officer_active(uuid, boolean) from public, anon;
revoke execute on function public.admin_reset_officer_two_step(uuid) from public, anon;

grant execute on function public.admin_officers() to authenticated;
grant execute on function public.officer_join_school(uuid) to authenticated;
grant execute on function public.officer_leave_school(uuid) to authenticated;
grant execute on function public.admin_set_officer_active(uuid, boolean) to authenticated;
grant execute on function public.admin_reset_officer_two_step(uuid) to authenticated;
