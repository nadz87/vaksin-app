-- Vaksin App: officers manage the appointment types; removing a clinic location or a type
-- cancels its upcoming bookings and emails each parent (owner decisions 2026-10-30).
--
-- 1. Types the clinic runs now: Suntikan HPV, ATT, DT and Saringan Talasemia (a blood test).
--    The four v1 types stay in the table (old bookings point at them) but are hidden.
-- 2. notify.email_outbox: emails queued by the database, sent by the sign-in service
--    (server/auth/src/outbox.ts). The schema is not exposed by PostgREST.
-- 3. Every officer cancellation goes through cancel_appointments_internal, which queues the
--    parent email. block_slots_internal (remove/block slots) now uses it too.
-- 4. add_appointment_type, remove_appointment_type, remove_location (any officer or the admin;
--    both lists are shared). The default clinic (kkp18) cannot be removed.
-- 5. Slots need a type (no more "any type"); parents never see slots of hidden types.
-- 6. my_appointments tells the parent whether the child's health profile is complete.

-- 1 -------------------------------------------------------------------------------------
alter table public.appointment_types add column created_by uuid references public.profiles (user_id);

update public.appointment_types set active = false
where code in ('screening', 'vaccination', 'unwell', 'follow_up');

insert into public.appointment_types (code, name_ms, name_en, icon, color, duration_min, default_capacity, needs_reason, sort_order) values
  ('hpv',         'Suntikan HPV',       'HPV injection',          'syringe', '#7C5CF0', 10, 10, false, 1),
  ('att',         'Suntikan ATT',       'ATT injection',          'syringe', '#2F6FED', 10, 10, false, 2),
  ('dt',          'Suntikan DT',        'DT injection',           'syringe', '#1F9D74', 10, 10, false, 3),
  ('thalassemia', 'Saringan Talasemia', 'Thalassaemia screening', 'drop',    '#E2557A', 15, 1,  false, 4)
on conflict (code) do update set active = true;

-- 2 -------------------------------------------------------------------------------------
create schema if not exists notify;
revoke all on schema notify from public;

create table notify.email_outbox (
  id         bigint generated always as identity primary key,
  kind       text not null,
  to_email   text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   smallint not null default 0,
  last_error text
);
create index email_outbox_pending on notify.email_outbox (id) where sent_at is null;

-- 3 -------------------------------------------------------------------------------------
-- Cancels booked appointments for the officer (or admin) calling, and queues one email per
-- appointment to the parent who booked it. Returns how many were cancelled.
create function public.cancel_appointments_internal(p_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Dibatalkan oleh pegawai kesihatan');
  v_n      int;
begin
  with done as (
    update public.appointments a
    set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = v_reason, updated_at = now()
    where a.id = any (p_ids) and a.status = 'booked'
    returning a.id, a.slot_id, a.student_id, a.type_id, a.booked_by
  ), queued as (
    insert into notify.email_outbox (kind, to_email, payload)
    select 'appointment_cancelled', p.email,
           jsonb_build_object('appointment', d.id, 'child', st.full_name, 'type_ms', t.name_ms,
                              'type_en', t.name_en, 'starts_at', s.starts_at, 'location', l.name,
                              'reason', v_reason)
    from done d
    join public.slots s on s.id = d.slot_id
    join public.locations l on l.id = s.location_id
    join public.students st on st.id = d.student_id
    join public.appointment_types t on t.id = d.type_id
    join public.profiles p on p.user_id = d.booked_by
    where nullif(trim(p.email), '') is not null
    returning 1
  )
  select (select count(*) from done) into v_n;

  if v_n > 0 then
    perform pg_notify('email_outbox', '');
  end if;
  return v_n;
end $$;

create or replace function public.block_slots_internal(p_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_cancelled int;
  v_reason    text := coalesce(nullif(trim(p_reason), ''), 'Dibatalkan oleh pegawai kesihatan');
begin
  select public.cancel_appointments_internal(coalesce(array_agg(a.id), '{}'), v_reason) into v_cancelled
  from public.appointments a
  where a.slot_id = any (p_ids) and a.status = 'booked';

  update public.slots set status = 'blocked' where id = any (p_ids);

  if cardinality(p_ids) > 0 then
    insert into public.audit_log (actor_id, action, entity, meta)
    values (auth.uid(), 'block_slots', 'slot',
            jsonb_build_object('slots', cardinality(p_ids), 'cancelled', v_cancelled, 'reason', v_reason));
  end if;
  return v_cancelled;
end $$;

-- Future slots of a location or a type: booked ones are blocked (bookings cancelled and the
-- parents emailed), slots no one ever booked are deleted. Returns {cancelled, removed}.
create function public.clear_future_slots_internal(p_ids uuid[], p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_busy      uuid[];
  v_empty     uuid[];
  v_cancelled int := 0;
begin
  select coalesce(array_agg(s.id) filter (where exists (select 1 from public.appointments a where a.slot_id = s.id)), '{}'),
         coalesce(array_agg(s.id) filter (where not exists (select 1 from public.appointments a where a.slot_id = s.id)), '{}')
  into v_busy, v_empty
  from public.slots s
  where s.id = any (p_ids) and s.starts_at > now();

  if cardinality(v_busy) > 0 then
    v_cancelled := public.block_slots_internal(v_busy, p_reason);
  end if;
  delete from public.slots where id = any (v_empty);
  return jsonb_build_object('cancelled', v_cancelled, 'removed', cardinality(v_empty));
end $$;

-- 4 -------------------------------------------------------------------------------------
create function public.add_appointment_type(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_base text;
  v_code text;
  v_n    int := 1;
  v_row  public.appointment_types;
  v_palette text[] := array['#7C5CF0', '#2F6FED', '#1F9D74', '#E2557A', '#E08A1E', '#0E8FA8'];
begin
  if not (public.is_officer() or public.is_platform_admin()) then
    raise exception 'not_allowed';
  end if;
  if length(v_name) < 3 or length(v_name) > 60 then
    raise exception 'bad_type';
  end if;

  -- The same name again: reuse it (and show it again if it had been removed).
  select * into v_row from public.appointment_types where lower(name_ms) = lower(v_name) order by active desc limit 1;
  if v_row.id is not null then
    update public.appointment_types set active = true where id = v_row.id;
    return jsonb_build_object('id', v_row.id, 'name', v_row.name_ms);
  end if;

  v_base := 'custom-' || left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 40);
  v_code := v_base;
  while exists (select 1 from public.appointment_types where code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || '-' || v_n;
  end loop;

  insert into public.appointment_types (code, name_ms, name_en, icon, color, duration_min, default_capacity,
                                        needs_reason, sort_order, created_by)
  select v_code, v_name, v_name,
         case when v_name ~* '(suntik|vaksin|imuni)' then 'syringe'
              when v_name ~* '(darah|talasemia)' then 'drop'
              else 'stethoscope' end,
         v_palette[1 + (select count(*) from public.appointment_types)::int % array_length(v_palette, 1)],
         15, 1, false,
         coalesce((select max(sort_order) from public.appointment_types where active), 0) + 1,
         auth.uid()
  returning * into v_row;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'add_appointment_type', 'appointment_type', v_row.id, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name_ms);
end $$;

create function public.remove_appointment_type(p_type uuid) returns jsonb
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

  select coalesce(array_agg(id), '{}') into v_slots
  from public.slots where appointment_type_id = p_type and starts_at > now();
  v_result := public.clear_future_slots_internal(v_slots, v_reason);

  -- Older "any type" slots: cancel only the bookings made for this type.
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

create function public.remove_location(p_location uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_loc    public.locations;
  v_slots  uuid[];
  v_result jsonb;
begin
  if not (public.is_officer() or public.is_platform_admin()) then
    raise exception 'not_allowed';
  end if;
  select * into v_loc from public.locations where id = p_location and active for update;
  if v_loc.id is null then
    raise exception 'bad_location';
  end if;
  if v_loc.slug = 'kkp18' then
    raise exception 'location_default';
  end if;

  select coalesce(array_agg(id), '{}') into v_slots
  from public.slots where location_id = p_location and starts_at > now();
  v_result := public.clear_future_slots_internal(v_slots,
    'Lokasi ' || v_loc.name || ' telah ditutup.');

  delete from public.availability_rules where location_id = p_location;
  update public.locations set active = false where id = p_location;

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'remove_location', 'location', p_location, v_result || jsonb_build_object('name', v_loc.name));
  return v_result;
end $$;

-- 5 -------------------------------------------------------------------------------------
create or replace function public.add_slots(p_location uuid, p_type uuid, p_date date, p_start time, p_end time,
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
  if p_type is null or not exists (select 1 from public.appointment_types t where t.id = p_type and t.active) then
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

create or replace function public.available_slots(p_student uuid, p_location uuid default null)
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
    and (s.appointment_type_id is null
         or exists (select 1 from public.appointment_types t where t.id = s.appointment_type_id and t.active))
    and s.starts_at >= now() + make_interval(hours => bs.min_lead_hours)
    and s.starts_at <  now() + make_interval(days => bs.booking_window_days)
  group by s.id, l.id, l.name
  having s.capacity - count(a.id) > 0
  order by s.starts_at;
end $$;

-- 6 -------------------------------------------------------------------------------------
drop function public.my_appointments();
create function public.my_appointments()
returns table (id uuid, status public.appointment_status, starts_at timestamptz, ends_at timestamptz,
               student_id uuid, student_name text, school_name text, location_name text, type_id uuid,
               type_code text, type_name_ms text, type_name_en text, reason_note text, cancel_reason text,
               can_cancel boolean, cancelled_by_officer boolean, child_profile_complete boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, s.starts_at, s.ends_at,
         st.id, st.full_name, sc.name, l.name,
         t.id, t.code, t.name_ms, t.name_en, a.reason_note, a.cancel_reason,
         (a.status = 'booked' and s.starts_at > now() + make_interval(hours => bs.cancel_cutoff_hours)),
         exists (select 1 from public.profiles p where p.user_id = a.cancelled_by and p.role = 'officer'),
         -- Every health field filled; parents write "Tiada" where there is nothing (owner).
         (st.blood_group is not null and st.height_cm is not null and st.weight_kg is not null
          and nullif(trim(st.allergies), '') is not null and nullif(trim(st.conditions), '') is not null
          and nullif(trim(st.medications), '') is not null
          and nullif(trim(st.emergency_contact_name), '') is not null
          and nullif(trim(st.emergency_contact_phone), '') is not null)
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

-- Grants --------------------------------------------------------------------------------
revoke execute on function public.cancel_appointments_internal(uuid[], text),
  public.clear_future_slots_internal(uuid[], text), public.block_slots_internal(uuid[], text)
  from public, anon, authenticated;

revoke execute on function public.add_appointment_type(text), public.remove_appointment_type(uuid),
  public.remove_location(uuid), public.my_appointments()
  from public, anon;
grant execute on function public.add_appointment_type(text), public.remove_appointment_type(uuid),
  public.remove_location(uuid), public.my_appointments()
  to authenticated;
