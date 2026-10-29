-- Vaksin App: functions the app calls (RPC). Each checks the caller itself,
-- because security definer bypasses RLS.

-- New schools always get default booking settings.
create function public.create_school_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_settings (school_id) values (new.id);
  return new;
end $$;

create trigger schools_settings after insert on public.schools
  for each row execute function public.create_school_settings();

-- Public: what a parent sees on the school link before signing in.
create function public.get_school_by_slug(p_slug text)
returns table (id uuid, name text, slug text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.slug, s.logo_url
  from public.schools s
  where s.slug = lower(p_slug) and s.active
$$;

-- Public: list of active schools for the "pick your school" screen.
create function public.list_schools()
returns table (id uuid, name text, slug text, state text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.slug, s.state, s.logo_url
  from public.schools s
  where s.active
  order by s.name
$$;

-- Parent joins a school by picking it (from the school link or the list).
create function public.join_school(p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  select id into v_school from public.schools where slug = lower(p_slug) and active;
  if v_school is null then
    raise exception 'school_not_found';
  end if;

  insert into public.parent_schools (parent_id, school_id)
  values (auth.uid(), v_school)
  on conflict do nothing;

  return v_school;
end $$;

-- Parent registers a child. Never reveals whether a MyKid already exists:
-- a duplicate becomes a guardian request for the existing parent/officer.
create function public.register_child(
  p_school_id    uuid,
  p_full_name    text,
  p_mykid        text,
  p_dob          date,
  p_gender       text,
  p_class_name   text,
  p_relationship text,
  p_consent      boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mykid    text := regexp_replace(coalesce(p_mykid, ''), '[^0-9]', '', 'g');
  v_existing uuid;
  v_student  uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if not public.is_parent_at(p_school_id) then
    raise exception 'not_joined_school';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'consent_required';
  end if;
  -- v_mykid is digits only already, so the length check is enough.
  -- Note: avoid CASE ... END inside these bodies; the Supabase CLI statement
  -- splitter counts its END as closing the function and cuts it in half.
  if length(v_mykid) <> 12 then
    raise exception 'invalid_mykid';
  end if;
  -- Date of birth and gender must match the MyKid (YYMMDD...last digit odd = male).
  if to_char(p_dob, 'YYMMDD') <> substr(v_mykid, 1, 6) then
    raise exception 'mykid_dob_mismatch';
  end if;
  if (mod(substr(v_mykid, 12, 1)::int, 2) = 1) <> (p_gender = 'male') then
    raise exception 'mykid_gender_mismatch';
  end if;

  select student_id into v_existing from public.student_identifiers where mykid_no = v_mykid;

  if v_existing is not null then
    if public.is_guardian_of(v_existing) then
      return jsonb_build_object('status', 'already_linked', 'student_id', v_existing);
    end if;
    insert into public.guardian_requests (student_id, requester_id, relationship)
    values (v_existing, auth.uid(), coalesce(p_relationship, 'guardian'))
    on conflict (student_id, requester_id) do nothing;
    return jsonb_build_object('status', 'request_pending');
  end if;

  insert into public.students (school_id, full_name, date_of_birth, gender, class_name, mykid_last4)
  values (p_school_id, trim(p_full_name), p_dob, p_gender, trim(p_class_name), right(v_mykid, 4))
  returning id into v_student;

  insert into public.student_identifiers (student_id, mykid_no) values (v_student, v_mykid);
  insert into public.student_guardians (student_id, guardian_id, relationship)
  values (v_student, auth.uid(), coalesce(p_relationship, 'guardian'));

  return jsonb_build_object('status', 'created', 'student_id', v_student);
end $$;

-- Existing guardian or the school's officer approves/rejects a link request.
create function public.decide_guardian_request(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.guardian_requests;
begin
  select * into r from public.guardian_requests where id = p_request and status = 'pending';
  if r.id is null then
    raise exception 'request_not_found';
  end if;
  if not (public.is_guardian_of(r.student_id)
          or public.is_officer_for(public.student_school(r.student_id))) then
    raise exception 'not_allowed';
  end if;

  update public.guardian_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now()
  where id = p_request;

  if p_approve then
    update public.guardian_requests set status = 'approved' where id = p_request;
    insert into public.student_guardians (student_id, guardian_id, relationship)
    values (r.student_id, r.requester_id, r.relationship)
    on conflict do nothing;
  end if;
end $$;

-- Officer reveals a full MyKid. Every reveal is logged.
create function public.reveal_mykid(p_student uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid := public.student_school(p_student);
  v_mykid  text;
begin
  if v_school is null or not public.is_officer_for(v_school) then
    raise exception 'not_allowed';
  end if;
  select mykid_no into v_mykid from public.student_identifiers where student_id = p_student;
  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'reveal_mykid', 'student', p_student, v_school);
  return v_mykid;
end $$;

-- Platform admin turns an existing account (signed in once) into an officer
-- for a school. Officer accounts are invited from the Supabase dashboard.
create function public.admin_assign_officer(p_email text, p_school uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not_allowed';
  end if;
  select user_id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'user_not_found';
  end if;

  update public.profiles set role = 'officer' where user_id = v_user and role = 'parent';
  insert into public.officer_schools (officer_id, school_id) values (v_user, p_school)
  on conflict do nothing;
  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'assign_officer', 'profile', v_user, p_school);
  return v_user;
end $$;

-- Lock down: functions are callable only by the roles that need them.
revoke execute on function public.get_school_by_slug(text) from public;
revoke execute on function public.list_schools() from public;
revoke execute on function public.join_school(text) from public;
revoke execute on function public.register_child(uuid, text, text, date, text, text, text, boolean) from public;
revoke execute on function public.decide_guardian_request(uuid, boolean) from public;
revoke execute on function public.reveal_mykid(uuid) from public;
revoke execute on function public.admin_assign_officer(text, uuid) from public;

grant execute on function public.get_school_by_slug(text) to anon, authenticated;
grant execute on function public.list_schools() to anon, authenticated;
grant execute on function public.join_school(text) to authenticated;
grant execute on function public.register_child(uuid, text, text, date, text, text, text, boolean) to authenticated;
grant execute on function public.decide_guardian_request(uuid, boolean) to authenticated;
grant execute on function public.reveal_mykid(uuid) to authenticated;
grant execute on function public.admin_assign_officer(text, uuid) to authenticated;
