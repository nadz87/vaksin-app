-- Vaksin App: officer home dashboard, adding/removing slots, marking appointments.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside function bodies.

-- 1. Week view data now also carries each booking's status and child id, and
--    keeps completed / no-show visits (only cancelled ones are left out).
create or replace function public.officer_slots(p_school uuid, p_from date, p_to date)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint,
               status public.slot_status, appointment_type_id uuid, booked int, bookings jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.appointment_type_id,
         (count(a.id) filter (where a.status in ('booked', 'completed', 'no_show')))::int,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'appointment_id', a.id,
             'status', a.status,
             'student_id', st.id,
             'student_no', st.student_no,
             'student_name', st.full_name,
             'class_name', st.class_name,
             'type_ms', t.name_ms,
             'type_en', t.name_en,
             'note', a.reason_note,
             'parent_name', pr.full_name,
             'parent_phone', pr.phone) order by a.created_at)
             filter (where a.status in ('booked', 'completed', 'no_show')),
           '[]'::jsonb)
  from public.slots s
  left join public.appointments a on a.slot_id = s.id
  left join public.students st on st.id = a.student_id
  left join public.appointment_types t on t.id = a.type_id
  left join public.profiles pr on pr.user_id = a.booked_by
  where s.school_id = p_school
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by s.id
  order by s.starts_at;
end $$;

-- 2. Home dashboard numbers for one school.
create function public.officer_dashboard(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_result jsonb;
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    'students_total',
      (select count(*) from public.students x where x.school_id = p_school),
    -- students who have made at least one appointment that was not cancelled
    'students_booked',
      (select count(distinct a.student_id) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status in ('booked', 'completed', 'no_show')),
    'bookings_week',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status <> 'cancelled' and a.created_at >= now() - interval '7 days'),
    'bookings_prev_week',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status <> 'cancelled'
         and a.created_at >= now() - interval '14 days' and a.created_at < now() - interval '7 days'),
    'today_total',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status in ('booked', 'completed', 'no_show')
         and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date = v_today),
    'today_done',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status in ('completed', 'no_show')
         and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date = v_today),
    'attended_90',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status = 'completed'
         and s.starts_at >= now() - interval '90 days' and s.starts_at <= now()),
    'no_show_90',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status = 'no_show'
         and s.starts_at >= now() - interval '90 days' and s.starts_at <= now()),
    -- how full the next 30 days of open slots are
    'capacity_30',
      (select coalesce(sum(s.capacity), 0) from public.slots s
       where s.school_id = p_school and s.status = 'open'
         and s.starts_at > now() and s.starts_at <= now() + interval '30 days'),
    'taken_30',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.school_id = p_school and a.status = 'booked' and s.status = 'open'
         and s.starts_at > now() and s.starts_at <= now() + interval '30 days')
  ) into v_result;

  return v_result;
end $$;

-- 3. Add slots on one date: a time range cut into equal slots. Skips anything
--    that is in the past or overlaps an existing slot of this officer.
create function public.add_slots(p_school uuid, p_date date, p_start time, p_end time,
                                 p_minutes int, p_capacity int, p_type uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n     int;
  v_count int;
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;
  if p_date is null or p_start is null or p_end is null or p_end <= p_start
     or p_minutes is null or p_minutes < 5 or p_minutes > 240
     or p_capacity is null or p_capacity < 1 or p_capacity > 100 then
    raise exception 'bad_slot';
  end if;
  if p_type is not null and not exists (select 1 from public.appointment_types t where t.id = p_type and t.active) then
    raise exception 'bad_slot';
  end if;

  v_n := (extract(epoch from (p_end - p_start)) / 60)::int / p_minutes;
  if v_n < 1 or v_n > 100 then
    raise exception 'bad_slot';
  end if;

  insert into public.slots (officer_id, school_id, starts_at, ends_at, capacity, appointment_type_id)
  select auth.uid(), p_school,
         (p_date + p_start + k * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur',
         (p_date + p_start + (k + 1) * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur',
         p_capacity, p_type
  from generate_series(0, v_n - 1) as k
  where (p_date + p_start + k * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur' > now()
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 4. Remove slots. A slot nobody ever booked is deleted. A slot that has (or had)
--    appointments is blocked instead and its bookings are cancelled with the
--    reason, so parents see why and history is kept.
create function public.remove_slots(p_ids uuid[], p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ok        uuid[];
  v_block     uuid[];
  v_del       uuid[];
  v_cancelled int := 0;
begin
  select coalesce(array_agg(s.id), '{}') into v_ok
  from public.slots s
  where s.id = any (p_ids) and public.is_officer_for(s.school_id);
  if coalesce(cardinality(v_ok), 0) <> coalesce(cardinality(p_ids), 0) then
    raise exception 'not_allowed';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_block
  from public.slots s
  where s.id = any (v_ok) and exists (select 1 from public.appointments a where a.slot_id = s.id);

  select coalesce(array_agg(x), '{}') into v_del
  from unnest(v_ok) as x
  where not (x = any (v_block));

  delete from public.slots where id = any (v_del);
  if cardinality(v_block) > 0 then
    v_cancelled := public.block_slots_internal(v_block, p_reason);
  end if;

  return jsonb_build_object('deleted', cardinality(v_del), 'blocked', cardinality(v_block), 'cancelled', v_cancelled);
end $$;

-- 5. Officer marks a visit done / no-show (or puts it back to booked).
--    Only on the appointment day or later.
create function public.set_appointment_outcome(p_appointment uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.slots;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.id is null then
    raise exception 'not_allowed';
  end if;
  select * into s from public.slots where id = a.slot_id;
  if not public.is_officer_for(s.school_id) then
    raise exception 'not_allowed';
  end if;
  if p_status not in ('booked', 'completed', 'no_show') or a.status = 'cancelled' then
    raise exception 'bad_status';
  end if;
  if (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date > (now() at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'too_early';
  end if;

  update public.appointments set status = p_status::public.appointment_status where id = p_appointment;

  insert into public.audit_log (actor_id, action, entity, entity_id, school_id, meta)
  values (auth.uid(), 'set_outcome', 'appointment', p_appointment, s.school_id, jsonb_build_object('status', p_status));
end $$;

revoke execute on function public.officer_dashboard(uuid) from public;
revoke execute on function public.add_slots(uuid, date, time, time, int, int, uuid) from public;
revoke execute on function public.remove_slots(uuid[], text) from public;
revoke execute on function public.set_appointment_outcome(uuid, text) from public;

grant execute on function public.officer_dashboard(uuid) to authenticated;
grant execute on function public.add_slots(uuid, date, time, time, int, int, uuid) to authenticated;
grant execute on function public.remove_slots(uuid[], text) to authenticated;
grant execute on function public.set_appointment_outcome(uuid, text) to authenticated;
