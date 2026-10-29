-- Vaksin App: parent booking (Phase 3, parent side).
-- Parents never insert into appointments directly; book_slot() locks the slot
-- row and checks every rule, so two parents can never take the last place.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside bodies
-- (the Supabase CLI statement splitter breaks on them).

-- Open slots at a school with places left, inside the booking window.
create function public.available_slots(p_school uuid)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz,
               appointment_type_id uuid, capacity smallint, remaining int)
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.booking_settings;
begin
  if not public.is_parent_at(p_school) then
    raise exception 'not_joined_school';
  end if;
  select * into bs from public.booking_settings where school_id = p_school;

  return query
  select s.id, s.starts_at, s.ends_at, s.appointment_type_id, s.capacity,
         (s.capacity - count(a.id))::int as remaining
  from public.slots s
  left join public.appointments a on a.slot_id = s.id and a.status = 'booked'
  where s.school_id = p_school
    and s.status = 'open'
    and s.starts_at >= now() + make_interval(hours => bs.min_lead_hours)
    and s.starts_at <  now() + make_interval(days => bs.booking_window_days)
  group by s.id
  having s.capacity - count(a.id) > 0
  order by s.starts_at;
end $$;

-- Book one place in a slot for a child.
create function public.book_slot(p_slot uuid, p_student uuid, p_type uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s        public.slots;
  bs       public.booking_settings;
  t        public.appointment_types;
  v_school uuid := public.student_school(p_student);
  v_taken  int;
  v_active int;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if not public.is_guardian_of(p_student) then
    raise exception 'not_guardian';
  end if;

  -- Lock the slot row: a second booking for the same slot waits here
  -- until this transaction finishes, then sees the updated count.
  select * into s from public.slots where id = p_slot for update;
  if s.id is null or s.status <> 'open' then
    raise exception 'slot_unavailable';
  end if;
  if s.school_id <> v_school then
    raise exception 'wrong_school';
  end if;

  select * into bs from public.booking_settings where school_id = s.school_id;
  if s.starts_at < now() + make_interval(hours => bs.min_lead_hours)
     or s.starts_at >= now() + make_interval(days => bs.booking_window_days) then
    raise exception 'slot_unavailable';
  end if;

  select * into t from public.appointment_types where id = p_type and active;
  if t.id is null or (s.appointment_type_id is not null and s.appointment_type_id <> p_type) then
    raise exception 'type_mismatch';
  end if;
  if t.needs_reason and coalesce(trim(p_note), '') = '' then
    raise exception 'reason_required';
  end if;

  select count(*) into v_taken from public.appointments
  where slot_id = p_slot and status = 'booked';
  if v_taken >= s.capacity then
    raise exception 'slot_full';
  end if;

  if exists (select 1 from public.appointments a join public.slots x on x.id = a.slot_id
             where a.student_id = p_student and a.type_id = p_type
               and a.status = 'booked' and x.starts_at > now()) then
    raise exception 'already_booked_type';
  end if;

  select count(*) into v_active from public.appointments a join public.slots x on x.id = a.slot_id
  where a.student_id = p_student and a.status = 'booked' and x.starts_at > now();
  if v_active >= bs.max_active_bookings_per_student then
    raise exception 'too_many_bookings';
  end if;

  insert into public.appointments (slot_id, student_id, type_id, booked_by, reason_note)
  values (p_slot, p_student, p_type, auth.uid(), nullif(trim(p_note), ''))
  returning id into v_id;

  return v_id;
end $$;

-- Parent's upcoming and past appointments for their children.
create function public.my_appointments()
returns table (id uuid, status public.appointment_status, starts_at timestamptz, ends_at timestamptz,
               student_id uuid, student_name text, school_name text,
               type_code text, type_name_ms text, type_name_en text, reason_note text,
               cancel_reason text, can_cancel boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, s.starts_at, s.ends_at,
         st.id, st.full_name, sc.name,
         t.code, t.name_ms, t.name_en, a.reason_note, a.cancel_reason,
         (a.status = 'booked'
          and s.starts_at > now() + make_interval(hours => bs.cancel_cutoff_hours)) as can_cancel
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  join public.students st on st.id = a.student_id
  join public.schools sc on sc.id = st.school_id
  join public.appointment_types t on t.id = a.type_id
  join public.booking_settings bs on bs.school_id = s.school_id
  where public.is_guardian_of(a.student_id)
  order by s.starts_at
$$;

-- Parent cancels, until cancel_cutoff_hours (24h) before the start.
create function public.cancel_appointment(p_appointment uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  a  public.appointments;
  s  public.slots;
  bs public.booking_settings;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.id is null or not public.is_guardian_of(a.student_id) then
    raise exception 'not_allowed';
  end if;
  if a.status <> 'booked' then
    raise exception 'not_booked';
  end if;
  select * into s from public.slots where id = a.slot_id;
  select * into bs from public.booking_settings where school_id = s.school_id;
  if s.starts_at <= now() + make_interval(hours => bs.cancel_cutoff_hours) then
    raise exception 'too_late_to_cancel';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = nullif(trim(p_reason), '')
  where id = p_appointment;
end $$;

revoke execute on function public.available_slots(uuid) from public;
revoke execute on function public.book_slot(uuid, uuid, uuid, text) from public;
revoke execute on function public.my_appointments() from public;
revoke execute on function public.cancel_appointment(uuid, text) from public;

grant execute on function public.available_slots(uuid) to authenticated;
grant execute on function public.book_slot(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.my_appointments() to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
