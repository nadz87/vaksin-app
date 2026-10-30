-- Vaksin App: appointments happen at clinic locations, not at schools (owner, 2026-10-30).
--   * Default location: Klinik Kesihatan Putrajaya P18 (link #/s/kkp18). Officers add more.
--   * Slots and weekly schedules belong to a location; the school is only the child's school.
--   * Any parent can book any open slot; booking limits follow the child's school settings.
--   * An officer sees a child (profile, MyKid, health info, guardians) only once that child has
--     or had an appointment in one of that officer's own slots. Officers no longer pick schools.

-- Locations ---------------------------------------------------------------------------------
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 3 and 120),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  address      text check (address is null or length(address) <= 200),
  weekend_days smallint[] not null default '{6,7}',
  active       boolean not null default true,
  created_by   uuid references public.profiles (user_id) on delete set null,
  created_at   timestamptz not null default now()
);
insert into public.locations (name, slug) values ('Klinik Kesihatan Putrajaya P18', 'kkp18');

alter table public.locations enable row level security;
create policy locations_read on public.locations for select to anon, authenticated using (active);

alter table public.slots add column location_id uuid references public.locations (id);
update public.slots set location_id = (select id from public.locations where slug = 'kkp18');
alter table public.slots alter column location_id set not null;
alter table public.slots alter column school_id drop not null;

alter table public.availability_rules add column location_id uuid references public.locations (id);
update public.availability_rules set location_id = (select id from public.locations where slug = 'kkp18');
alter table public.availability_rules alter column location_id set not null;
alter table public.availability_rules alter column school_id drop not null;

-- Closures are now an officer's own days off.
alter table public.closures alter column school_id drop not null;

-- Access helpers -----------------------------------------------------------------------------
create function public.is_officer() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_aal2() and exists (
    select 1 from public.profiles where user_id = auth.uid() and role = 'officer')
$$;

create function public.officer_owns_slot(p_slot uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_officer() and exists (
    select 1 from public.slots where id = p_slot and officer_id = auth.uid())
$$;

-- The child has (or had) an appointment in one of this officer's slots.
create function public.officer_sees_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_officer() and exists (
    select 1 from public.appointments a join public.slots s on s.id = a.slot_id
     where a.student_id = p_student and s.officer_id = auth.uid())
$$;

-- Rules: replace "officer of this school" -----------------------------------------------------
drop policy slots_officer_all on public.slots;
create policy slots_officer_all on public.slots for all to authenticated
  using (officer_id = auth.uid() and public.is_officer())
  with check (officer_id = auth.uid() and public.is_officer());
drop policy slots_parent_read on public.slots;
create policy slots_parent_read on public.slots for select to authenticated using (status = 'open');

drop policy rules_officer_all on public.availability_rules;
create policy rules_officer_all on public.availability_rules for all to authenticated
  using (officer_id = auth.uid() and public.is_officer())
  with check (officer_id = auth.uid() and public.is_officer());

drop policy closures_officer_all on public.closures;
create policy closures_officer_all on public.closures for all to authenticated
  using (officer_id = auth.uid() and public.is_officer())
  with check (officer_id = auth.uid() and public.is_officer());

drop policy appointments_officer_read on public.appointments;
create policy appointments_officer_read on public.appointments for select to authenticated
  using (public.officer_owns_slot(slot_id));
drop policy appointments_officer_update on public.appointments;
create policy appointments_officer_update on public.appointments for update to authenticated
  using (public.officer_owns_slot(slot_id)) with check (public.officer_owns_slot(slot_id));

drop policy visit_notes_officer_all on public.visit_notes;
create policy visit_notes_officer_all on public.visit_notes for all to authenticated
  using (exists (select 1 from public.appointments a
                  where a.id = visit_notes.appointment_id and public.officer_owns_slot(a.slot_id)))
  with check (officer_id = auth.uid() and exists (select 1 from public.appointments a
                  where a.id = visit_notes.appointment_id and public.officer_owns_slot(a.slot_id)));

drop policy students_read on public.students;
create policy students_read on public.students for select to authenticated
  using (public.is_guardian_of(id) or public.officer_sees_student(id));
drop policy students_officer_update on public.students;
create policy students_officer_update on public.students for update to authenticated
  using (public.officer_sees_student(id)) with check (public.officer_sees_student(id));

drop policy guardians_read on public.student_guardians;
create policy guardians_read on public.student_guardians for select to authenticated
  using (guardian_id = auth.uid() or public.is_guardian_of(student_id) or public.officer_sees_student(student_id));

drop policy guardian_requests_read on public.guardian_requests;
create policy guardian_requests_read on public.guardian_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_guardian_of(student_id) or public.officer_sees_student(student_id));

drop policy profiles_officer_reads_guardians on public.profiles;
create policy profiles_officer_reads_guardians on public.profiles for select to authenticated
  using (exists (select 1 from public.student_guardians sg
                  where sg.guardian_id = profiles.user_id and public.officer_sees_student(sg.student_id)));

drop policy parent_schools_read on public.parent_schools;
create policy parent_schools_read on public.parent_schools for select to authenticated
  using (parent_id = auth.uid());

-- School names and booking settings are not personal; parents pick schools for their children.
drop policy schools_read on public.schools;
create policy schools_read on public.schools for select to authenticated using (true);
drop policy settings_read on public.booking_settings;
create policy settings_read on public.booking_settings for select to authenticated using (true);
drop policy settings_officer_write on public.booking_settings;
create policy settings_officer_write on public.booking_settings for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_platform_admin() or actor_id = auth.uid());

-- Old school-picking functions ----------------------------------------------------------------
drop function public.officer_join_school(uuid);
drop function public.officer_leave_school(uuid);
drop function public.admin_assign_officer(text, uuid);

-- Locations: officers add them ------------------------------------------------------------------
create function public.add_location(p_name text, p_address text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_n    int := 1;
  v_row  public.locations;
begin
  if not (public.is_officer() or public.is_platform_admin()) then
    raise exception 'not_allowed';
  end if;
  if length(v_name) < 3 or length(v_name) > 120 or length(coalesce(p_address, '')) > 200 then
    raise exception 'bad_location';
  end if;
  select * into v_row from public.locations where lower(name) = lower(v_name) and active;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'slug', v_row.slug);
  end if;

  v_base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 50);
  if length(v_base) < 2 then
    v_base := 'lokasi';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.locations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.locations (name, slug, address, created_by)
  values (v_name, v_slug, nullif(trim(p_address), ''), auth.uid())
  returning * into v_row;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'add_location', 'location', v_row.id, jsonb_build_object('name', v_row.name));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'slug', v_row.slug);
end $$;

-- Slots: added per location and appointment type --------------------------------------------------
drop function public.add_slots(uuid, date, time, time, integer, integer, uuid);
create function public.add_slots(p_location uuid, p_type uuid, p_date date, p_start time, p_end time,
                                 p_minutes integer, p_capacity integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n     int;
  v_count int;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'bad_location';
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

  insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id)
  select auth.uid(), p_location,
         (p_date + p_start + k * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur',
         (p_date + p_start + (k + 1) * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur',
         p_capacity, p_type
  from generate_series(0, v_n - 1) as k
  where (p_date + p_start + k * make_interval(mins => p_minutes)) at time zone 'Asia/Kuala_Lumpur' > now()
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.check_availability_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_weekend smallint[];
begin
  select weekend_days into v_weekend from public.locations where id = new.location_id;
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

  insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id)
  select g.officer_id, g.location_id, g.s_at, g.e_at, g.capacity, g.type_id
  from (
    select r.officer_id, r.location_id, r.capacity,
           (v_from + k + r.start_time + n * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as s_at,
           (v_from + k + r.start_time + (n + 1) * make_interval(mins => r.slot_minutes)) at time zone 'Asia/Kuala_Lumpur' as e_at,
           -- exactly one allowed type -> slot is for that type; none or several -> any type
           (r.appointment_type_ids)[(cardinality(r.appointment_type_ids) = 1)::int] as type_id,
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
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- An officer's own days off: their open slots that day are blocked.
drop function public.add_closure(uuid, date, text);
create function public.add_closure(p_date date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  insert into public.closures (officer_id, date, reason)
  select auth.uid(), p_date, nullif(trim(p_reason), '')
  where not exists (select 1 from public.closures c where c.officer_id = auth.uid() and c.date = p_date);

  select coalesce(array_agg(id), '{}') into v_ids from public.slots
  where officer_id = auth.uid() and status = 'open'
    and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = p_date;
  return public.block_slots_internal(v_ids, coalesce(nullif(trim(p_reason), ''), 'Pegawai tidak bertugas'));
end $$;

create or replace function public.remove_closure(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.closures;
begin
  select * into c from public.closures where id = p_closure;
  if c.id is null or c.officer_id is distinct from auth.uid() or not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  delete from public.closures where id = p_closure;
  update public.slots set status = 'open'
  where officer_id = c.officer_id and status = 'blocked'
    and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = c.date;
end $$;

create or replace function public.block_slots_internal(p_ids uuid[], p_reason text) returns integer
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

  if cardinality(p_ids) > 0 then
    insert into public.audit_log (actor_id, action, entity, meta)
    values (auth.uid(), 'block_slots', 'slot',
            jsonb_build_object('slots', cardinality(p_ids), 'cancelled', v_cancelled, 'reason', v_reason));
  end if;
  return v_cancelled;
end $$;

create or replace function public.remove_slots(p_ids uuid[], p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ok        uuid[];
  v_block     uuid[];
  v_del       uuid[];
  v_cancelled int := 0;
begin
  select coalesce(array_agg(s.id), '{}') into v_ok
  from public.slots s
  where s.id = any (p_ids) and public.officer_owns_slot(s.id);
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

create or replace function public.set_slot_blocked(p_slot uuid, p_blocked boolean, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not public.officer_owns_slot(p_slot) then
    raise exception 'not_allowed';
  end if;
  if p_blocked then
    return public.block_slots_internal(array[p_slot], p_reason);
  end if;
  update public.slots set status = 'open' where id = p_slot;
  return 0;
end $$;

-- The officer's calendar: all their own slots, with the location.
drop function public.officer_slots(uuid, date, date);
create function public.officer_slots(p_from date, p_to date)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint, status public.slot_status,
               appointment_type_id uuid, location_id uuid, location_name text, booked integer, bookings jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad_range';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.appointment_type_id, s.location_id, l.name,
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

drop function public.officer_venues(date, date);
create function public.officer_venues(p_from date, p_to date)
returns table (day date, location_id uuid, location_name text, location_slug text, address text,
               first_start timestamptz, last_end timestamptz, slots integer, booked integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad_range';
  end if;

  return query
  select (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date,
         l.id, l.name, l.slug, l.address,
         min(s.starts_at), max(s.ends_at),
         (count(distinct s.id))::int,
         (count(a.id))::int
  from public.slots s
  join public.locations l on l.id = s.location_id
  left join public.appointments a on a.slot_id = s.id and a.status in ('booked', 'completed', 'no_show')
  where s.officer_id = auth.uid()
    and s.status = 'open'
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by 1, 2, 3, 4, 5
  order by 1, min(s.starts_at);
end $$;

drop function public.officer_dashboard(uuid);
create function public.officer_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_me     uuid := auth.uid();
  v_result jsonb;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;

  select jsonb_build_object(
    -- children who have ever booked one of my slots
    'students_total',
      (select count(distinct a.student_id) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me),
    'students_booked',
      (select count(distinct a.student_id) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status in ('booked', 'completed', 'no_show')),
    'bookings_week',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status <> 'cancelled' and a.created_at >= now() - interval '7 days'),
    'bookings_prev_week',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status <> 'cancelled'
         and a.created_at >= now() - interval '14 days' and a.created_at < now() - interval '7 days'),
    'today_total',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status in ('booked', 'completed', 'no_show')
         and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date = v_today),
    'today_done',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status in ('completed', 'no_show')
         and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date = v_today),
    'attended_90',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status = 'completed'
         and s.starts_at >= now() - interval '90 days' and s.starts_at <= now()),
    'no_show_90',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status = 'no_show'
         and s.starts_at >= now() - interval '90 days' and s.starts_at <= now()),
    'capacity_30',
      (select coalesce(sum(s.capacity), 0) from public.slots s
       where s.officer_id = v_me and s.status = 'open'
         and s.starts_at > now() and s.starts_at <= now() + interval '30 days'),
    'taken_30',
      (select count(*) from public.appointments a join public.slots s on s.id = a.slot_id
       where s.officer_id = v_me and a.status = 'booked' and s.status = 'open'
         and s.starts_at > now() and s.starts_at <= now() + interval '30 days')
  ) into v_result;
  return v_result;
end $$;

-- Children booked into this officer's slots.
drop function public.officer_students(uuid);
create function public.officer_students()
returns table (id uuid, student_no text, full_name text, class_name text, school_name text, gender text,
               date_of_birth date, mykid_last4 text, parent_name text, parent_phone text, upcoming integer,
               next_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;

  return query
  select st.id, st.student_no, st.full_name, st.class_name, sc.name, st.gender, st.date_of_birth, st.mykid_last4,
         g.full_name, g.phone,
         coalesce(u.n, 0)::int, u.next_at
  from public.students st
  join public.schools sc on sc.id = st.school_id
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
    where a.student_id = st.id and s.officer_id = auth.uid() and a.status = 'booked' and s.starts_at > now()) u on true
  where exists (select 1 from public.appointments a join public.slots s on s.id = a.slot_id
                 where a.student_id = st.id and s.officer_id = auth.uid())
  order by st.full_name;
end $$;

create or replace function public.officer_student_profile(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not public.officer_sees_student(p_student) then
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
    -- only the appointments in this officer's own slots
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'starts_at', s.starts_at, 'location_name', l.name,
        'type_ms', t.name_ms, 'type_en', t.name_en,
        'note', a.reason_note, 'cancel_reason', a.cancel_reason) order by s.starts_at desc)
      from public.appointments a
      join public.slots s on s.id = a.slot_id
      join public.locations l on l.id = s.location_id
      join public.appointment_types t on t.id = a.type_id
      where a.student_id = st.id and s.officer_id = auth.uid()), '[]'::jsonb))
  into v_result
  from public.students st
  join public.schools sc on sc.id = st.school_id
  where st.id = p_student;

  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'view_profile', 'student', p_student, public.student_school(p_student));
  return v_result;
end $$;

create or replace function public.reveal_mykid(p_student uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_mykid text;
begin
  if not public.officer_sees_student(p_student) then
    raise exception 'not_allowed';
  end if;
  select mykid_no into v_mykid from public.student_identifiers where student_id = p_student;
  insert into public.audit_log (actor_id, action, entity, entity_id, school_id)
  values (auth.uid(), 'reveal_mykid', 'student', p_student, public.student_school(p_student));
  return v_mykid;
end $$;

create or replace function public.set_appointment_outcome(p_appointment uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.appointments;
  s public.slots;
begin
  select * into a from public.appointments where id = p_appointment for update;
  if a.id is null or not public.officer_owns_slot(a.slot_id) then
    raise exception 'not_allowed';
  end if;
  select * into s from public.slots where id = a.slot_id;
  if p_status not in ('booked', 'completed', 'no_show') or a.status = 'cancelled' then
    raise exception 'bad_status';
  end if;
  if (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date > (now() at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'too_early';
  end if;

  update public.appointments set status = p_status::public.appointment_status where id = p_appointment;
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'set_outcome', 'appointment', p_appointment, jsonb_build_object('status', p_status));
end $$;

create or replace function public.decide_guardian_request(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.guardian_requests;
begin
  select * into r from public.guardian_requests where id = p_request and status = 'pending';
  if r.id is null then
    raise exception 'request_not_found';
  end if;
  if not (public.is_guardian_of(r.student_id) or public.officer_sees_student(r.student_id)) then
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

-- Exports: the officer's own children and appointments.
drop function public.export_students(uuid, boolean);
create function public.export_students(p_include_mykid boolean)
returns table (student_no text, full_name text, mykid text, date_of_birth date, gender text, class_name text,
               school_name text, blood_group text, height_cm numeric, weight_kg numeric, allergies text,
               conditions text, medications text, emergency_contact_name text, emergency_contact_phone text,
               parent1_name text, parent1_relationship text, parent1_phone text, parent1_email text,
               parent1_address text, parent2_name text, parent2_relationship text, parent2_phone text,
               registered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  select count(*) into v_rows from public.students x where public.officer_sees_student(x.id);
  insert into public.audit_log (actor_id, action, entity, meta)
  values (auth.uid(), 'export_students', 'officer',
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
  where public.officer_sees_student(st.id)
  order by sc.name, st.class_name, st.full_name;
end $$;

drop function public.export_appointments(uuid, date, date);
create function public.export_appointments(p_from date, p_to date)
returns table (starts_at timestamptz, location_name text, student_no text, student_name text, school_name text,
               class_name text, type_ms text, type_en text, status text, note text, cancel_reason text,
               cancelled_by_officer boolean, parent_name text, parent_phone text, booked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'bad_range';
  end if;
  select count(*) into v_rows
  from public.appointments a join public.slots s on s.id = a.slot_id
  where s.officer_id = auth.uid() and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to;
  insert into public.audit_log (actor_id, action, entity, meta)
  values (auth.uid(), 'export_appointments', 'officer', jsonb_build_object('rows', v_rows, 'from', p_from, 'to', p_to));

  return query
  select s.starts_at, l.name, st.student_no, st.full_name, sc.name, st.class_name, t.name_ms, t.name_en,
         a.status::text, a.reason_note, a.cancel_reason,
         exists (select 1 from public.profiles o where o.user_id = a.cancelled_by and o.role = 'officer'),
         pr.full_name, pr.phone, a.created_at
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  join public.locations l on l.id = s.location_id
  join public.students st on st.id = a.student_id
  join public.schools sc on sc.id = st.school_id
  join public.appointment_types t on t.id = a.type_id
  left join public.profiles pr on pr.user_id = a.booked_by
  where s.officer_id = auth.uid()
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  order by s.starts_at, st.full_name;
end $$;

-- Parents: any open slot at any location; limits follow the child's school -------------------------
drop function public.available_slots(uuid);
create function public.available_slots(p_student uuid, p_location uuid default null)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, appointment_type_id uuid, capacity smallint,
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
  select s.id, s.starts_at, s.ends_at, s.appointment_type_id, s.capacity,
         (s.capacity - count(a.id))::int as remaining, l.id, l.name
  from public.slots s
  join public.locations l on l.id = s.location_id and l.active
  left join public.appointments a on a.slot_id = s.id and a.status = 'booked'
  where s.status = 'open'
    and (p_location is null or s.location_id = p_location)
    and s.starts_at >= now() + make_interval(hours => bs.min_lead_hours)
    and s.starts_at <  now() + make_interval(days => bs.booking_window_days)
  group by s.id, l.id, l.name
  having s.capacity - count(a.id) > 0
  order by s.starts_at;
end $$;

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
  if t.id is null or (s.appointment_type_id is not null and s.appointment_type_id <> p_type) then
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

create or replace function public.cancel_appointment(p_appointment uuid, p_reason text) returns void
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
  select * into bs from public.booking_settings where school_id = public.student_school(a.student_id);
  if s.starts_at <= now() + make_interval(hours => bs.cancel_cutoff_hours) then
    raise exception 'too_late_to_cancel';
  end if;
  update public.appointments
  set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = nullif(trim(p_reason), '')
  where id = p_appointment;
end $$;

drop function public.my_appointments();
create function public.my_appointments()
returns table (id uuid, status public.appointment_status, starts_at timestamptz, ends_at timestamptz,
               student_id uuid, student_name text, school_name text, location_name text, type_code text,
               type_name_ms text, type_name_en text, reason_note text, cancel_reason text,
               can_cancel boolean, cancelled_by_officer boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, s.starts_at, s.ends_at,
         st.id, st.full_name, sc.name, l.name,
         t.code, t.name_ms, t.name_en, a.reason_note, a.cancel_reason,
         (a.status = 'booked' and s.starts_at > now() + make_interval(hours => bs.cancel_cutoff_hours)),
         exists (select 1 from public.profiles p where p.user_id = a.cancelled_by and p.role = 'officer')
  from public.appointments a
  join public.slots s on s.id = a.slot_id
  join public.locations l on l.id = s.location_id
  join public.students st on st.id = a.student_id
  join public.schools sc on sc.id = st.school_id
  join public.appointment_types t on t.id = a.type_id
  join public.booking_settings bs on bs.school_id = st.school_id
  where public.is_guardian_of(a.student_id)
  order by s.starts_at
$$;

-- Parents choose any active school for their child (no joining schools first).
create or replace function public.register_child(p_school_id uuid, p_full_name text, p_mykid text, p_dob date,
                                                 p_gender text, p_class_name text, p_relationship text,
                                                 p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_mykid    text := regexp_replace(coalesce(p_mykid, ''), '[^0-9]', '', 'g');
  v_existing uuid;
  v_student  uuid;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id and active) then
    raise exception 'school_not_found';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'consent_required';
  end if;
  if length(v_mykid) <> 12 then
    raise exception 'invalid_mykid';
  end if;
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

-- Admin page: the locations each officer runs slots at (instead of schools).
drop function public.admin_officers();
create function public.admin_officers()
returns table (user_id uuid, email text, full_name text, phone text, job_title text, active boolean,
               registered boolean, invited_at timestamptz, last_sign_in_at timestamptz, locations jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then
    raise exception 'not_allowed';
  end if;
  return query
  select p.user_id, p.email, p.full_name, p.phone, p.job_title, u.disabled_at is null,
         u.last_sign_in_at is not null, u.created_at, u.last_sign_in_at,
         coalesce((select jsonb_agg(distinct jsonb_build_object('id', l.id, 'name', l.name))
                     from public.slots s join public.locations l on l.id = s.location_id
                    where s.officer_id = p.user_id), '[]'::jsonb)
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.role = 'officer'
   order by u.last_sign_in_at is null, p.full_name nulls last, p.email;
end $$;

-- Who may call what ----------------------------------------------------------------------------------
revoke execute on function public.is_officer(), public.officer_owns_slot(uuid), public.officer_sees_student(uuid)
  from public, anon;
grant execute on function public.is_officer(), public.officer_owns_slot(uuid), public.officer_sees_student(uuid)
  to authenticated;
revoke execute on function public.add_location(text, text), public.add_slots(uuid, uuid, date, time, time, integer, integer),
  public.add_closure(date, text), public.officer_slots(date, date), public.officer_venues(date, date),
  public.officer_dashboard(), public.officer_students(), public.export_students(boolean),
  public.export_appointments(date, date), public.available_slots(uuid, uuid), public.my_appointments(),
  public.admin_officers()
  from public, anon;
grant execute on function public.add_location(text, text), public.add_slots(uuid, uuid, date, time, time, integer, integer),
  public.add_closure(date, text), public.officer_slots(date, date), public.officer_venues(date, date),
  public.officer_dashboard(), public.officer_students(), public.export_students(boolean),
  public.export_appointments(date, date), public.available_slots(uuid, uuid), public.my_appointments(),
  public.admin_officers()
  to authenticated;

-- The authenticator app is gone (staff sign in with the emailed code only).
drop function public.admin_reset_officer_two_step(uuid);
