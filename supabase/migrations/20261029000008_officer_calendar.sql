-- Vaksin App: officer calendar (Phase 2).
-- Weekly schedule per school -> generated slots; closures; block/unblock.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside bodies
-- (the Supabase CLI statement splitter breaks on them).

create extension if not exists btree_gist with schema extensions;

-- The one officer can never be in two places at once, at any school:
-- no two slots of the same officer may overlap in time (back-to-back is fine).
alter table public.slots
  add constraint slots_no_overlap
  exclude using gist (officer_id with =, tstzrange(starts_at, ends_at) with &&);

-- Schedule rules: not on the school's weekend, and never overlapping another
-- rule of the same officer (that includes rules at other schools).
create function public.check_availability_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_weekend smallint[];
begin
  select weekend_days into v_weekend from public.schools where id = new.school_id;
  if new.weekday = any (v_weekend) then
    raise exception 'weekend_day';
  end if;
  if exists (
    select 1 from public.availability_rules r
    where r.officer_id = new.officer_id
      and r.id <> new.id
      and r.weekday = new.weekday
      and r.start_time < new.end_time and new.start_time < r.end_time
      and daterange(r.valid_from, r.valid_to, '[]') && daterange(new.valid_from, new.valid_to, '[]')
  ) then
    raise exception 'rule_overlap';
  end if;
  return new;
end $$;

create trigger availability_rules_check before insert or update on public.availability_rules
  for each row execute function public.check_availability_rule();

-- Officer: turn my weekly rules into slots for the next N weeks (Malaysia time).
-- Skips closures, past times and anything that already exists or overlaps,
-- so running it again never duplicates. Returns how many slots were added.
create function public.generate_my_slots(p_weeks int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_from  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 1), 12);
  v_count int;
begin
  if not (public.has_aal2() and exists (
      select 1 from public.profiles where user_id = auth.uid() and role = 'officer')) then
    raise exception 'not_allowed';
  end if;

  insert into public.slots (officer_id, school_id, starts_at, ends_at, capacity, appointment_type_id)
  select g.officer_id, g.school_id, g.s_at, g.e_at, g.capacity, g.type_id
  from (
    select r.officer_id, r.school_id, r.capacity,
           (v_from + k + r.start_time + n * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as s_at,
           (v_from + k + r.start_time + (n + 1) * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as e_at,
           -- exactly one allowed type -> slot is for that type; none or several -> any type.
           -- (index 1 when cardinality = 1, else index 0, which is NULL)
           (r.appointment_type_ids)[(cardinality(r.appointment_type_ids) = 1)::int] as type_id,
           (v_from + k) as day
    from public.availability_rules r
    cross join generate_series(0, v_weeks * 7) as k
    cross join lateral generate_series(
      0, ((extract(epoch from (r.end_time - r.start_time)) / 60)::int / r.slot_minutes) - 1) as n
    where r.officer_id = auth.uid()
      and extract(isodow from v_from + k) = r.weekday
      and (v_from + k) >= r.valid_from
      and (r.valid_to is null or (v_from + k) <= r.valid_to)
      and exists (select 1 from public.officer_schools os
                  where os.officer_id = r.officer_id and os.school_id = r.school_id)
  ) g
  where g.s_at > now()
    and not exists (
      select 1 from public.closures c
      where c.school_id = g.school_id and c.date = g.day
        and (c.officer_id is null or c.officer_id = g.officer_id))
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Internal: block slots and cancel what was booked in them, with a reason.
-- Not granted to anyone; the public functions below check who is calling.
create function public.block_slots_internal(p_ids uuid[], p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_cancelled int;
  v_reason    text := coalesce(nullif(trim(p_reason), ''), 'Dibatalkan oleh pegawai kesihatan');
begin
  update public.appointments
  set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = v_reason
  where slot_id = any (p_ids) and status = 'booked';
  get diagnostics v_cancelled = row_count;

  update public.slots set status = 'blocked' where id = any (p_ids);

  -- One audit row per school touched (none when there was nothing to block).
  insert into public.audit_log (actor_id, action, entity, school_id, meta)
  select auth.uid(), 'block_slots', 'slot', g.school_id,
         jsonb_build_object('slots', cardinality(p_ids), 'cancelled', v_cancelled, 'reason', v_reason)
  from (select school_id from public.slots where id = any (p_ids) group by school_id) g;

  return v_cancelled;
end $$;

-- Officer blocks or reopens one slot. Blocking cancels its bookings.
create function public.set_slot_blocked(p_slot uuid, p_blocked boolean, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid := public.slot_school(p_slot);
begin
  if v_school is null or not public.is_officer_for(v_school) then
    raise exception 'not_allowed';
  end if;
  if p_blocked then
    return public.block_slots_internal(array[p_slot], p_reason);
  end if;
  update public.slots set status = 'open' where id = p_slot;
  return 0;
end $$;

-- Officer closes a school for a day (holiday, exam...): blocks every slot
-- that day and cancels their bookings. Returns how many bookings were cancelled.
create function public.add_closure(p_school uuid, p_date date, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  insert into public.closures (school_id, date, reason)
  select p_school, p_date, nullif(trim(p_reason), '')
  where not exists (select 1 from public.closures c
                    where c.school_id = p_school and c.date = p_date and c.officer_id is null);

  select coalesce(array_agg(id), '{}') into v_ids from public.slots
  where school_id = p_school and status = 'open'
    and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = p_date;

  return public.block_slots_internal(v_ids, coalesce(nullif(trim(p_reason), ''), 'Sekolah tutup'));
end $$;

-- Removing a closure reopens every blocked slot that day (cancelled
-- bookings are not restored).
create function public.remove_closure(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.closures;
begin
  select * into c from public.closures where id = p_closure;
  if c.id is null or not public.is_officer_for(c.school_id) then
    raise exception 'not_allowed';
  end if;
  delete from public.closures where id = p_closure;
  update public.slots set status = 'open'
  where school_id = c.school_id and status = 'blocked'
    and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = c.date;
end $$;

-- Officer's week: slots with how many are booked and who.
create function public.officer_slots(p_school uuid, p_from date, p_to date)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint,
               status public.slot_status, appointment_type_id uuid, booked int, bookings jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.appointment_type_id,
         (count(a.id) filter (where a.status = 'booked'))::int,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'appointment_id', a.id,
             'student_name', st.full_name,
             'class_name', st.class_name,
             'type_ms', t.name_ms,
             'type_en', t.name_en,
             'note', a.reason_note,
             'parent_name', pr.full_name,
             'parent_phone', pr.phone) order by a.created_at) filter (where a.status = 'booked'),
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

-- Parents: show when an appointment was cancelled by the officer.
drop function public.my_appointments();
create function public.my_appointments()
returns table (id uuid, status public.appointment_status, starts_at timestamptz, ends_at timestamptz,
               student_id uuid, student_name text, school_name text,
               type_code text, type_name_ms text, type_name_en text, reason_note text,
               cancel_reason text, can_cancel boolean, cancelled_by_officer boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, s.starts_at, s.ends_at,
         st.id, st.full_name, sc.name,
         t.code, t.name_ms, t.name_en, a.reason_note, a.cancel_reason,
         (a.status = 'booked'
          and s.starts_at > now() + make_interval(hours => bs.cancel_cutoff_hours)),
         exists (select 1 from public.profiles p where p.user_id = a.cancelled_by and p.role = 'officer')
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  join public.students st on st.id = a.student_id
  join public.schools sc on sc.id = st.school_id
  join public.appointment_types t on t.id = a.type_id
  join public.booking_settings bs on bs.school_id = s.school_id
  where public.is_guardian_of(a.student_id)
  order by s.starts_at
$$;

revoke execute on function public.generate_my_slots(int) from public;
revoke execute on function public.block_slots_internal(uuid[], text) from public;
revoke execute on function public.set_slot_blocked(uuid, boolean, text) from public;
revoke execute on function public.add_closure(uuid, date, text) from public;
revoke execute on function public.remove_closure(uuid) from public;
revoke execute on function public.officer_slots(uuid, date, date) from public;
revoke execute on function public.my_appointments() from public;

grant execute on function public.generate_my_slots(int) to authenticated;
grant execute on function public.set_slot_blocked(uuid, boolean, text) to authenticated;
grant execute on function public.add_closure(uuid, date, text) to authenticated;
grant execute on function public.remove_closure(uuid) to authenticated;
grant execute on function public.officer_slots(uuid, date, date) to authenticated;
grant execute on function public.my_appointments() to authenticated;
