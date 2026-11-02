-- Vaksin App: one slot can be shared by several appointment types (owner, 2026-11-02).
-- slots.appointment_type_ids lists the types a slot takes; empty means any type (older slots).
-- capacity stays one number per slot, so any mix of the listed types can fill it.
-- Slots sharing a type still cannot overlap; an array cannot go in an exclusion constraint, so a
-- trigger holds that rule. The other-location constraint is unchanged.

alter table public.slots drop constraint slots_no_overlap_same_type;
alter table public.slots add column appointment_type_ids uuid[] not null default '{}';
update public.slots set appointment_type_ids = array[appointment_type_id] where appointment_type_id is not null;
alter table public.slots drop column appointment_type_id;
create index slots_type_ids_idx on public.slots using gin (appointment_type_ids);

-- Do two type lists clash? They share a type, or both are "any type".
create function public.slot_types_clash(a uuid[], b uuid[]) returns boolean
language sql immutable set search_path = '' as $$
  select a operator(pg_catalog.&&) b or (cardinality(a) = 0 and cardinality(b) = 0)
$$;

create function public.check_slot_types() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- One officer at a time, so two requests cannot both pass the check.
  perform pg_advisory_xact_lock(hashtextextended(new.officer_id::text, 0));
  if exists (
    select 1 from public.slots x
    where x.officer_id = new.officer_id and x.id <> new.id
      and x.starts_at < new.ends_at and new.starts_at < x.ends_at
      and public.slot_types_clash(x.appointment_type_ids, new.appointment_type_ids)
  ) then
    raise exception 'slot_overlap';
  end if;
  return new;
end $$;

create trigger slots_check_types
  before insert or update of officer_id, starts_at, ends_at, appointment_type_ids on public.slots
  for each row execute function public.check_slot_types();

-- Adding slots -------------------------------------------------------------------------------
create function public.add_slots_for_types(p_location uuid, p_types uuid[], p_date date, p_start time, p_end time,
                                           p_minutes integer, p_capacity integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_types uuid[] := array(select distinct x from unnest(p_types) as x where x is not null order by 1);
  v_n     int;
  v_count int;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'bad_location';
  end if;
  if cardinality(v_types) = 0 or exists (
    select 1 from unnest(v_types) as x
    where not exists (select 1 from public.appointment_types t where t.id = x and t.active)
  ) then
    raise exception 'bad_type';
  end if;
  if p_date is null or p_start is null or p_end is null or p_end <= p_start
     or p_minutes is null or p_minutes < 5 or p_minutes > 240
     or p_capacity is null or p_capacity < 1 or p_capacity > 100 then
    raise exception 'bad_slot';
  end if;
  v_n := (extract(epoch from (p_end - p_start)) / 60)::int / p_minutes;
  if v_n < 1 or v_n > 100 then
    raise exception 'bad_slot';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  -- Times that clash are skipped, not refused: the rest of the range is still added.
  insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_ids)
  select auth.uid(), p_location, g.s_at, g.e_at, p_capacity, v_types
  from (
    select (p_date + p_start + k * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur' as s_at,
           (p_date + p_start + (k + 1) * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur' as e_at
    from generate_series(0, v_n - 1) as k
  ) g
  where g.s_at > now()
    and not exists (
      select 1 from public.slots x
      where x.officer_id = auth.uid() and x.starts_at < g.e_at and g.s_at < x.ends_at
        and public.slot_types_clash(x.appointment_type_ids, v_types))
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- One type: kept so a phone still on the previous version of the site keeps working.
create or replace function public.add_slots(p_location uuid, p_type uuid, p_date date, p_start time, p_end time,
                                            p_minutes integer, p_capacity integer)
returns integer language sql security definer set search_path = '' as $$
  select public.add_slots_for_types(p_location, array[p_type], p_date, p_start, p_end, p_minutes, p_capacity)
$$;

create or replace function public.generate_my_slots(p_weeks integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 1), 12);
  v_count int;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_ids)
  select g.officer_id, g.location_id, g.s_at, g.e_at, g.capacity, g.types
  from (
    select r.officer_id, r.location_id, r.capacity,
           (v_from + k + r.start_time + n * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as s_at,
           (v_from + k + r.start_time + (n + 1) * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as e_at,
           coalesce(r.appointment_type_ids, '{}') as types,
           (v_from + k) as day
    from public.availability_rules r
    join public.locations l on l.id = r.location_id and l.active
    cross join generate_series(0, v_weeks * 7) as k
    cross join lateral generate_series(
      0, ((extract(epoch from (r.end_time - r.start_time)) / 60)::int / r.slot_minutes) - 1) as n
    where r.officer_id = auth.uid()
      and extract(isodow from v_from + k) = r.weekday
      and (v_from + k) >= r.valid_from
      and (r.valid_to is null or (v_from + k) <= r.valid_to)
  ) g
  where g.s_at > now()
    and not exists (select 1 from public.closures c where c.officer_id = g.officer_id and c.date = g.day)
    and not exists (
      select 1 from public.slots x
      where x.officer_id = g.officer_id and x.starts_at < g.e_at and g.s_at < x.ends_at
        and public.slot_types_clash(x.appointment_type_ids, g.types))
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Reading slots ------------------------------------------------------------------------------
drop function public.officer_slots(date, date);
create function public.officer_slots(p_from date, p_to date)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint, status public.slot_status,
               appointment_type_ids uuid[], location_id uuid, location_name text, booked integer, bookings jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad_range';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.appointment_type_ids, s.location_id, l.name,
         (count(a.id) filter (where a.status in ('booked', 'completed', 'no_show')))::int,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'appointment_id', a.id,
             'status', a.status,
             'student_id', st.id,
             'student_no', st.student_no,
             'student_name', st.full_name,
             'class_name', st.class_name,
             'school_name', sc.name,
             'type_ms', t.name_ms,
             'type_en', t.name_en,
             'note', a.reason_note,
             'parent_name', pr.full_name,
             'parent_phone', pr.phone) order by a.created_at)
             filter (where a.status in ('booked', 'completed', 'no_show')),
           '[]'::jsonb)
  from public.slots s
  join public.locations l on l.id = s.location_id
  left join public.appointments a on a.slot_id = s.id
  left join public.students st on st.id = a.student_id
  left join public.schools sc on sc.id = st.school_id
  left join public.appointment_types t on t.id = a.type_id
  left join public.profiles pr on pr.user_id = a.booked_by
  where s.officer_id = auth.uid()
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by s.id, l.name
  order by s.starts_at;
end $$;

drop function public.officer_upcoming_slots();
create function public.officer_upcoming_slots()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint,
               appointment_type_ids uuid[], location_name text, booked integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.appointment_type_ids, l.name,
         (count(a.id) filter (where a.status = 'booked'))::int
  from public.slots s
  join public.locations l on l.id = s.location_id
  left join public.appointments a on a.slot_id = s.id
  where s.officer_id = auth.uid()
    and s.status = 'open'
    and cardinality(s.appointment_type_ids) > 0
    and s.starts_at > now()
  group by s.id, l.name
  order by s.starts_at
  limit 2000;
end $$;

drop function public.available_slots(uuid, uuid);
create function public.available_slots(p_student uuid, p_location uuid default null)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, appointment_type_ids uuid[], capacity smallint,
               remaining integer, location_id uuid, location_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.booking_settings;
begin
  if not public.is_guardian_of(p_student) then
    raise exception 'not_guardian';
  end if;
  select * into bs from public.booking_settings where school_id = public.student_school(p_student);

  return query
  select s.id, s.starts_at, s.ends_at,
         -- Only the types still offered, so a parent is never shown one they cannot book.
         array(select x from unnest(s.appointment_type_ids) as x
               where exists (select 1 from public.appointment_types t where t.id = x and t.active)),
         s.capacity,
         (s.capacity - count(a.id))::int as remaining, l.id, l.name
  from public.slots s
  join public.locations l on l.id = s.location_id and l.active
  left join public.appointments a on a.slot_id = s.id and a.status = 'booked'
  where s.status = 'open'
    and (p_location is null or s.location_id = p_location)
    and (cardinality(s.appointment_type_ids) = 0
         or exists (select 1 from public.appointment_types t where t.id = any (s.appointment_type_ids) and t.active))
    and s.starts_at >= now() + make_interval(hours => bs.min_lead_hours)
    and s.starts_at <  now() + make_interval(days => bs.booking_window_days)
  group by s.id, l.id, l.name
  having s.capacity - count(a.id) > 0
  order by s.starts_at;
end $$;

revoke execute on function public.add_slots_for_types(uuid, uuid[], date, time, time, integer, integer) from public, anon;
revoke execute on function public.officer_slots(date, date) from public, anon;
revoke execute on function public.officer_upcoming_slots() from public, anon;
revoke execute on function public.available_slots(uuid, uuid) from public, anon;
revoke execute on function public.check_slot_types() from public, anon, authenticated;
grant execute on function public.add_slots_for_types(uuid, uuid[], date, time, time, integer, integer) to authenticated;
grant execute on function public.officer_slots(date, date) to authenticated;
grant execute on function public.officer_upcoming_slots() to authenticated;
grant execute on function public.available_slots(uuid, uuid) to authenticated;

-- Booking ------------------------------------------------------------------------------------
create or replace function public.book_slot(p_slot uuid, p_student uuid, p_type uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s        public.slots;
  bs       public.booking_settings;
  t        public.appointment_types;
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

  select * into bs from public.booking_settings where school_id = public.student_school(p_student);
  if s.starts_at < now() + make_interval(hours => bs.min_lead_hours)
     or s.starts_at >= now() + make_interval(days => bs.booking_window_days) then
    raise exception 'slot_unavailable';
  end if;

  select * into t from public.appointment_types where id = p_type and active;
  if t.id is null or (cardinality(s.appointment_type_ids) > 0 and not p_type = any (s.appointment_type_ids)) then
    raise exception 'type_mismatch';
  end if;
  if t.needs_reason and coalesce(trim(p_note), '') = '' then
    raise exception 'reason_required';
  end if;

  select count(*) into v_taken from public.appointments where slot_id = p_slot and status = 'booked';
  if v_taken >= s.capacity then
    raise exception 'slot_full';
  end if;
  if exists (select 1 from public.appointments a join public.slots x on x.id = a.slot_id
             where a.student_id = p_student and a.type_id = p_type and a.status = 'booked' and x.starts_at > now()) then
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

-- Removing a type ----------------------------------------------------------------------------
-- A slot with another type still offered stays open for that type; the rest are cleared.
create or replace function public.remove_appointment_type(p_type uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_type   public.appointment_types;
  v_reason text;
  v_slots  uuid[];
  v_result jsonb;
  v_more   int;
begin
  if not (public.is_officer() or public.is_platform_admin()) then
    raise exception 'not_allowed';
  end if;
  select * into v_type from public.appointment_types where id = p_type and active for update;
  if v_type.id is null then
    raise exception 'bad_type';
  end if;
  if not exists (select 1 from public.appointment_types where active and id <> p_type) then
    raise exception 'last_type';
  end if;
  v_reason := v_type.name_ms || ' tidak lagi ditawarkan.';

  select coalesce(array_agg(s.id), '{}') into v_slots
  from public.slots s
  where p_type = any (s.appointment_type_ids) and s.starts_at > now()
    and not exists (select 1 from public.appointment_types t
                    where t.id = any (s.appointment_type_ids) and t.active and t.id <> p_type);
  v_result := public.clear_future_slots_internal(v_slots, v_reason);

  update public.slots set appointment_type_ids = array_remove(appointment_type_ids, p_type)
  where p_type = any (appointment_type_ids) and starts_at > now() and not (id = any (v_slots));

  -- Shared and any-type slots: cancel only the bookings made for this type.
  select public.cancel_appointments_internal(coalesce(array_agg(a.id), '{}'), v_reason) into v_more
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  where a.type_id = p_type and a.status = 'booked' and s.starts_at > now();

  update public.appointment_types set active = false where id = p_type;

  v_result := jsonb_set(v_result, '{cancelled}', to_jsonb((v_result ->> 'cancelled')::int + v_more));
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'remove_appointment_type', 'appointment_type', p_type,
          v_result || jsonb_build_object('name', v_type.name_ms));
  return v_result;
end $$;
