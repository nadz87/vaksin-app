-- Vaksin App: appointment types managed by officers, removing a type or a location
-- (bookings cancelled, parents emailed through notify.email_outbox), profile-complete flag.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'parent@types.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'officer@types.test');
update public.profiles set role = 'officer', full_name = 'Officer Types', job_title = 'Nurse'
where user_id = '00000000-0000-0000-0000-0000000000e2';

insert into public.schools (id, name, slug) values
  ('20000000-0000-0000-0000-0000000000e1', 'Types School', 'types-school');
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('30000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1', 'Child Types', '2014-01-01', 'female', '6A', '0011');
insert into public.student_guardians (student_id, guardian_id) values
  ('30000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1');

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.type_id(p_code text) returns uuid language sql as $$
  select id from public.appointment_types where code = p_code
$$;
create function pg_temp.kl_day(p_days int) returns date language sql as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date + p_days
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.type_id(text), pg_temp.kl_day(int) to authenticated;

-- The clinic's list ------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select is((select array_agg(name_ms order by sort_order) from public.appointment_types),
  array['Suntikan HPV', 'Suntikan ATT', 'Suntikan DT', 'Saringan Talasemia'],
  'parents see only the four types the clinic runs');
select throws_ok($$ select public.add_appointment_type('Suntikan MMR') $$, 'not_allowed',
  'a parent cannot create a type');

-- Officer creates a type -------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select public.add_appointment_type('ab') $$, 'bad_type', 'a type name needs 3 characters');
select ok((select (public.add_appointment_type('  Suntikan   MMR ') ->> 'name') = 'Suntikan MMR'),
  'officer creates "Suntikan MMR" (spaces tidied)');
select is((public.add_appointment_type('suntikan mmr') ->> 'id')::uuid, pg_temp.type_id('custom-suntikan-mmr'),
  'the same name again returns the same type');
select is((select icon from public.appointment_types where code = 'custom-suntikan-mmr'), 'syringe',
  'an injection type gets the syringe icon');

select throws_ok(
  format($$ select public.add_slots(%L, null, pg_temp.kl_day(3), '09:00', '09:30', 15, 1) $$,
         (select id from public.locations where slug = 'kkp18')),
  'bad_type', 'slots need an appointment type now');
select is(public.add_slots((select id from public.locations where slug = 'kkp18'), pg_temp.type_id('custom-suntikan-mmr'),
                           pg_temp.kl_day(3), '09:00', '09:30', 15, 1), 2,
  'officer adds two MMR slots at KK P18');

-- Parent books one; officer removes the type -------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select ok(public.book_slot(
  (select id from public.slots where appointment_type_id = pg_temp.type_id('custom-suntikan-mmr') order by starts_at limit 1),
  '30000000-0000-0000-0000-0000000000e1', pg_temp.type_id('custom-suntikan-mmr'), null) is not null,
  'parent books an MMR slot');
select is((select child_profile_complete from public.my_appointments() limit 1), false,
  'the health profile is not complete yet');
update public.students
set blood_group = 'O+', height_cm = 140, weight_kg = 35, allergies = 'Tiada', conditions = 'Tiada',
    medications = 'Tiada', emergency_contact_name = 'Mak Cik', emergency_contact_phone = '+60123456780'
where id = '30000000-0000-0000-0000-0000000000e1';
select is((select child_profile_complete from public.my_appointments() limit 1), true,
  'complete once every health field is filled ("Tiada" counts)');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select is(public.remove_appointment_type(pg_temp.type_id('custom-suntikan-mmr')),
  '{"cancelled": 1, "removed": 1}'::jsonb,
  'removing the type cancels the booking and deletes the empty slot');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select is((select status::text || '/' || cancelled_by_officer::text from public.my_appointments() limit 1), 'cancelled/true',
  'the parent sees the appointment as cancelled by the officer');
select is((select count(*) from public.appointment_types where code = 'custom-suntikan-mmr')::int, 0,
  'the removed type is hidden from parents');
select throws_ok($$ select count(*) from notify.email_outbox $$, '42501', null,
  'parents cannot read the email queue');

reset role;
select is((select to_email || ' ' || (payload ->> 'child') || ' ' || (payload ->> 'type_ms')
           from notify.email_outbox where kind = 'appointment_cancelled' order by id desc limit 1),
  'parent@types.test Child Types Suntikan MMR',
  'an email to the parent is queued with the child and the type');

-- "Any type" slot: removing a type cancels only that type's bookings -------------------------
insert into public.slots (id, officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id) values
  ('40000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
   (select id from public.locations where slug = 'kkp18'), now() + interval '5 days', now() + interval '5 days 15 minutes', 5, null);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select ok(public.book_slot('40000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e1',
  pg_temp.type_id('dt'), null) is not null, 'parent books DT in an older any-type slot');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select is((public.remove_appointment_type(pg_temp.type_id('dt')) ->> 'cancelled')::int, 1,
  'removing DT cancels that booking');
select is((select status::text from public.slots where id = '40000000-0000-0000-0000-0000000000e1'), 'open',
  'the any-type slot stays open for other types');

reset role;
update public.appointment_types set active = false where code in ('hpv', 'att');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select throws_ok(format($$ select public.remove_appointment_type(%L) $$, pg_temp.type_id('thalassemia')),
  'last_type', 'the last type cannot be removed');

-- Locations ------------------------------------------------------------------------------------
select throws_ok(format($$ select public.remove_location(%L) $$, (select id from public.locations where slug = 'kkp18')),
  'location_default', 'the default clinic cannot be removed');
select is(public.add_slots((public.add_location('Klinik Ujian Hapus', null) ->> 'id')::uuid, pg_temp.type_id('thalassemia'),
                           pg_temp.kl_day(4), '10:00', '10:30', 15, 1), 2,
  'officer adds two slots at a new location');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select ok(public.book_slot(
  (select s.id from public.slots s join public.locations l on l.id = s.location_id
   where l.slug = 'klinik-ujian-hapus' order by s.starts_at limit 1),
  '30000000-0000-0000-0000-0000000000e1', pg_temp.type_id('thalassemia'), null) is not null,
  'parent books there');
select throws_ok(format($$ select public.remove_location(%L) $$, (select id from public.locations where slug = 'klinik-ujian-hapus')),
  'not_allowed', 'a parent cannot remove a location');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select is(public.remove_location((select id from public.locations where slug = 'klinik-ujian-hapus')),
  '{"cancelled": 1, "removed": 1}'::jsonb,
  'removing the location cancels its booking and deletes the empty slot');

select * from finish();
rollback;
