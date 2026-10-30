-- Vaksin App: booking rules (book_slot, available_slots, cancel_appointment).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Fixtures (as postgres, bypassing RLS). Slots are at KK Putrajaya P18; booking limits
-- follow the child's school settings. Parents no longer join schools; the parent_schools
-- rows below are left in place but no longer matter.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'parent.a@book.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'parent.b@book.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'officer@book.test');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-0000000000c2';

insert into public.schools (id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', 'Booking School', 'booking-school');

insert into public.parent_schools (parent_id, school_id) values
  ('00000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000001');

insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'Child A', '2016-01-01', 'male', '3A', '0001'),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 'Child B', '2016-02-02', 'female', '3B', '0002');
insert into public.student_guardians (student_id, guardian_id) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2');

-- s1: in 3 days, 1 place, any type   s2: in 3 hours (inside 24h cancel cutoff)
-- s3: in 4 days, vaccination only, 10 places
insert into public.slots (id, officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', (select id from public.locations where slug = 'kkp18'),
   now() + interval '3 days', now() + interval '3 days 15 minutes', 1, null),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', (select id from public.locations where slug = 'kkp18'),
   now() + interval '3 hours', now() + interval '3 hours 15 minutes', 1, null),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c2', (select id from public.locations where slug = 'kkp18'),
   now() + interval '4 days', now() + interval '4 days 30 minutes', 10,
   (select id from public.appointment_types where code = 'vaccination'));

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.type_id(p_code text) returns uuid language sql as $$
  select id from public.appointment_types where code = p_code
$$;

-- Parent A -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');

select is((select count(*) from public.available_slots('30000000-0000-0000-0000-00000000000a'))::int, 3,
  'parent sees the 3 open slots');

select lives_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', %L, null) $$,
         pg_temp.type_id('screening')),
  'parent A books the last place in s1');

select throws_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', %L, null) $$,
         pg_temp.type_id('screening')),
  'already_booked_type', 'same child cannot hold two upcoming bookings of one type');

select throws_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', %L, '  ') $$,
         pg_temp.type_id('unwell')),
  'reason_required', '"Feeling unwell" needs a note');

select throws_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-00000000000a', %L, null) $$,
         pg_temp.type_id('follow_up')),
  'type_mismatch', 'vaccination-only slot rejects other types');

select throws_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000b', %L, null) $$,
         pg_temp.type_id('screening')),
  'not_guardian', 'cannot book for someone else''s child');

select lives_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', %L, null) $$,
         pg_temp.type_id('follow_up')),
  'parent A books s2 (3 hours away) as follow-up');

select throws_ok(
  $$ select public.cancel_appointment((select id from public.appointments where slot_id = '40000000-0000-0000-0000-000000000002'), null) $$,
  'too_late_to_cancel', 'cannot cancel inside the 24-hour cutoff');

select is((select count(*) from public.my_appointments())::int, 2, 'parent A sees both bookings');

-- Parent B -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');

select is((select count(*) from public.available_slots('30000000-0000-0000-0000-00000000000b'))::int, 1,
  'full slots (s1, s2) disappear for other parents');

select throws_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000b', %L, null) $$,
         pg_temp.type_id('screening')),
  'slot_full', 'second parent cannot take a full slot');

-- Parent A cancels s1 (3 days away), then parent B can take it -------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.cancel_appointment((select id from public.appointments where slot_id = '40000000-0000-0000-0000-000000000001'), 'Tukar hari') $$,
  'parent cancels more than 24 hours before');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  format($$ select public.book_slot('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000b', %L, null) $$,
         pg_temp.type_id('screening')),
  'freed place can be booked by parent B');

select * from finish();
rollback;
