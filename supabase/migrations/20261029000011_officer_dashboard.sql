-- Vaksin App: officer dashboard (student list, patient profile, Excel export data).
-- Every function checks the caller is an officer of that school with 2-step
-- verification (is_officer_for requires aal2). Profile views and exports are
-- written to audit_log. The full MyKid number is never returned unless asked for.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside function bodies.

-- Student list for one school: one row per child, with the first parent and
-- the next booked appointment.
create function public.officer_students(p_school uuid)
returns table (id uuid, student_no text, full_name text, class_name text, gender text,
               date_of_birth date, mykid_last4 text, parent_name text, parent_phone text,
               upcoming int, next_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  return query
  select st.id, st.student_no, st.full_name, st.class_name, st.gender, st.date_of_birth, st.mykid_last4,
         g.full_name, g.phone,
         coalesce(u.n, 0)::int, u.next_at
  from public.students st
  left join lateral (
    select pr.full_name, pr.phone
    from public.student_guardians sg
    join public.profiles pr on pr.user_id = sg.guardian_id
    where sg.student_id = st.id
    order by sg.consent_at
    limit 1) g on true
  left join lateral (
    select count(*) as n, min(s.starts_at) as next_at
    from public.appointments a
    join public.slots s on s.id = a.slot_id
    where a.student_id = st.id and a.status = 'booked' and s.starts_at > now()) u on true
  where st.school_id = p_school
  order by st.class_name, st.full_name;
end $$;

-- Patient profile: child, parents (with address) and appointment history. Logged.
create function public.officer_student_profile(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid := public.student_school(p_student);
  v_result jsonb;
begin
  if v_school is null or not public.is_officer_for(v_school) then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', st.id, 'student_no', st.student_no, 'full_name', st.full_name,
      'class_name', st.class_name, 'gender', st.gender, 'date_of_birth', st.date_of_birth,
      'mykid_last4', st.mykid_last4, 'blood_group', st.blood_group,
      'height_cm', st.height_cm, 'weight_kg', st.weight_kg,
      'allergies', st.allergies, 'conditions', st.conditions, 'medications', st.medications,
      'emergency_contact_name', st.emergency_contact_name,
      'emergency_contact_phone', st.emergency_contact_phone,
      'school_name', sc.name),
    'guardians', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationship', sg.relationship, 'full_name', pr.full_name, 'phone', pr.phone, 'email', pr.email,
        'address_line1', pr.address_line1, 'address_line2', pr.address_line2,
        'postcode', pr.postcode, 'city', pr.city, 'state', pr.state) order by sg.consent_at)
      from public.student_guardians sg
      join public.profiles pr on pr.user_id = sg.guardian_id
      where sg.student_id = st.id), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'starts_at', s.starts_at,
        'type_ms', t.name_ms, 'type_en', t.name_en,
        'note', a.reason_note, 'cancel_reason', a.cancel_reason) order by s.starts_at desc)
      from public.appointments a
      join public.slots s on s.id = a.slot_id
      join public.appointment_types t on t.id = a.type_id
      where a.student_id = st.id), '[]'::jsonb))
  into v_result
  from public.students st
  join public.schools sc on sc.id = st.school_id
  where st.id = p_student;

  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'view_profile', 'student', p_student, v_school);

  return v_result;
end $$;

-- Excel data: one row per child. The full MyKid is included only if asked for,
-- and that choice is recorded in the audit log.
create function public.export_students(p_school uuid, p_include_mykid boolean)
returns table (student_no text, full_name text, mykid text, date_of_birth date, gender text,
               class_name text, school_name text, blood_group text, height_cm numeric, weight_kg numeric,
               allergies text, conditions text, medications text,
               emergency_contact_name text, emergency_contact_phone text,
               parent1_name text, parent1_relationship text, parent1_phone text, parent1_email text,
               parent1_address text,
               parent2_name text, parent2_relationship text, parent2_phone text,
               registered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  select count(*) into v_rows from public.students x where x.school_id = p_school;
  insert into public.audit_log (actor_id, action, entity, school_id, meta)
  values (auth.uid(), 'export_students', 'school', p_school,
          jsonb_build_object('rows', v_rows, 'include_mykid', coalesce(p_include_mykid, false)));

  return query
  select st.student_no, st.full_name,
         (select i.mykid_no from public.student_identifiers i where i.student_id = st.id and coalesce(p_include_mykid, false)),
         st.date_of_birth, st.gender, st.class_name, sc.name, st.blood_group, st.height_cm, st.weight_kg,
         st.allergies, st.conditions, st.medications, st.emergency_contact_name, st.emergency_contact_phone,
         g1.full_name, g1.relationship, g1.phone, g1.email, g1.address,
         g2.full_name, g2.relationship, g2.phone,
         st.created_at
  from public.students st
  join public.schools sc on sc.id = st.school_id
  left join lateral (
    select pr.full_name, sg.relationship, pr.phone, pr.email,
           concat_ws(', ', pr.address_line1, pr.address_line2, concat_ws(' ', pr.postcode, pr.city), pr.state) as address
    from public.student_guardians sg
    join public.profiles pr on pr.user_id = sg.guardian_id
    where sg.student_id = st.id
    order by sg.consent_at
    limit 1) g1 on true
  left join lateral (
    select pr.full_name, sg.relationship, pr.phone
    from public.student_guardians sg
    join public.profiles pr on pr.user_id = sg.guardian_id
    where sg.student_id = st.id
    order by sg.consent_at
    offset 1 limit 1) g2 on true
  where st.school_id = p_school
  order by st.class_name, st.full_name;
end $$;

-- Excel data: appointments in a date range (Malaysia dates), one row each.
create function public.export_appointments(p_school uuid, p_from date, p_to date)
returns table (starts_at timestamptz, student_no text, student_name text, class_name text,
               type_ms text, type_en text, status text, note text, cancel_reason text,
               cancelled_by_officer boolean, parent_name text, parent_phone text, booked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'bad_range';
  end if;

  select count(*) into v_rows
  from public.appointments a join public.slots s on s.id = a.slot_id
  where s.school_id = p_school and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to;
  insert into public.audit_log (actor_id, action, entity, school_id, meta)
  values (auth.uid(), 'export_appointments', 'school', p_school,
          jsonb_build_object('rows', v_rows, 'from', p_from, 'to', p_to));

  return query
  select s.starts_at, st.student_no, st.full_name, st.class_name, t.name_ms, t.name_en,
         a.status::text, a.reason_note, a.cancel_reason,
         exists (select 1 from public.profiles o where o.user_id = a.cancelled_by and o.role = 'officer'),
         pr.full_name, pr.phone, a.created_at
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  join public.students st on st.id = a.student_id
  join public.appointment_types t on t.id = a.type_id
  left join public.profiles pr on pr.user_id = a.booked_by
  where s.school_id = p_school
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  order by s.starts_at, st.full_name;
end $$;

revoke execute on function public.officer_students(uuid) from public;
revoke execute on function public.officer_student_profile(uuid) from public;
revoke execute on function public.export_students(uuid, boolean) from public;
revoke execute on function public.export_appointments(uuid, date, date) from public;

grant execute on function public.officer_students(uuid) to authenticated;
grant execute on function public.officer_student_profile(uuid) to authenticated;
grant execute on function public.export_students(uuid, boolean) to authenticated;
grant execute on function public.export_appointments(uuid, date, date) to authenticated;
