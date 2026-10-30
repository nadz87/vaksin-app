-- Vaksin App: officer home numbers, adding/removing slots, marking visits.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'parent@home.test'),
  ('00000000-0000-0000-0000-0000000000c9', 'officer@home.test'),
  ('00000000-0000-0000-0000-0000000000ca', 'other.officer@home.test');
update public.profiles set role = 'officer'
where user_id in ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000ca');

insert into public.schools (id, name, slug) values
  ('c1000000-0000-0000-0000-00000000000a', 'Home School A', 'home-school-a'),
  ('c1000000-0000-0000-0000-00000000000b', 'Home School B', 'home-school-b');
insert into public.officer_schools values
  ('00000000-0000-0000-0000-0000000000c9', 'c1000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000ca', 'c1000000-0000-0000-0000-00000000000b');

insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('d1000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Home Child One', '2016-01-01', 'male', '3A', '0011'),
  ('d1000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000a', 'Home Child Two', '2016-02-02', 'female', '3B', '0012');
insert into public.student_guardians (student_id, guardian_id) values
  ('d1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a9'),
  ('d1000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a9');

-- A slot earlier today (Malaysia time) with a booking, and one in 2 days with a booking.
-- "today" slot: use the current Malaysian date at 00:10-00:25 so it always counts as today.
insert into public.slots (id, officer_id, location_id, starts_at, ends_at, capacity) values
  ('e1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c9', (select id from public.locations where slug = 'kkp18'),
   ((now() at time zone 'Asia/Kuala_Lumpur')::date + time '00:10') at time zone 'Asia/Kuala_Lumpur',
   ((now() at time zone 'Asia/Kuala_Lumpur')::date + time '00:25') at time zone 'Asia/Kuala_Lumpur', 1),
  ('e1000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c9', (select id from public.locations where slug = 'kkp18'),
   now() + interval '2 days', now() + interval '2 days 15 minutes', 1);
insert into public.appointments (id, slot_id, student_id, type_id, booked_by)
select 'f1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', t.id,
       '00000000-0000-0000-0000-0000000000a9' from public.appointment_types t where t.code = 'screening';
insert into public.appointments (id, slot_id, student_id, type_id, booked_by)
select 'f1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', t.id,
       '00000000-0000-0000-0000-0000000000a9' from public.appointment_types t where t.code = 'screening';

create function pg_temp.act_as(p_user uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Officer of school A -------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');

select is((public.officer_dashboard() ->> 'students_total')::int, 2,
  'dashboard counts the children who booked the officer''s slots');
select is((public.officer_dashboard() ->> 'students_booked')::int, 2,
  'dashboard counts the students who made an appointment');
select is((public.officer_dashboard() ->> 'today_total')::int, 1,
  'dashboard counts today''s appointments');
select is((public.officer_dashboard() ->> 'today_done')::int, 0,
  'nothing is marked done yet');

-- Venue: where the officer is scheduled
select is(
  (select location_name from public.officer_venues((now() at time zone 'Asia/Kuala_Lumpur')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date)),
  'Klinik Kesihatan Putrajaya P18', 'the officer''s venue today is the location where their slots are');
select is(
  (select booked from public.officer_venues((now() at time zone 'Asia/Kuala_Lumpur')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date)),
  1, 'the venue counts what is booked there');

-- Marking a visit
select throws_ok(
  $$ select public.set_appointment_outcome('f1000000-0000-0000-0000-00000000000b', 'completed') $$,
  'too_early', 'a future appointment cannot be marked done');
select lives_ok(
  $$ select public.set_appointment_outcome('f1000000-0000-0000-0000-00000000000a', 'completed') $$,
  'today''s appointment can be marked done');
select is((public.officer_dashboard() ->> 'today_done')::int, 1,
  'the dashboard shows it as done');
select throws_ok(
  $$ select public.set_appointment_outcome('f1000000-0000-0000-0000-00000000000a', 'cancelled') $$,
  'bad_status', 'the officer cannot set a status that is not booked, done or no-show');

-- Adding slots: 09:00-10:00 in 15 minutes, 3 days ahead = 4 slots; again adds nothing
select is(public.add_slots((select id from public.locations where slug = 'kkp18'), null, (now() at time zone 'Asia/Kuala_Lumpur')::date + 3, '09:00', '10:00', 15, 1), 4,
  'adding 09:00-10:00 in 15-minute steps creates 4 slots');
select is(public.add_slots((select id from public.locations where slug = 'kkp18'), null, (now() at time zone 'Asia/Kuala_Lumpur')::date + 3, '09:00', '10:00', 15, 1), 0,
  'adding the same times again creates nothing (no overlap)');
select throws_ok(
  $$ select public.add_slots((select id from public.locations where slug = 'kkp18'), null, (now() at time zone 'Asia/Kuala_Lumpur')::date + 3, '10:00', '09:00', 15, 1) $$,
  'bad_slot', 'an end time before the start time is refused');

-- Removing slots: an unbooked one is deleted, a booked one is blocked and its booking cancelled
select is(
  (public.remove_slots(array[(select id from public.slots where location_id = (select id from public.locations where slug = 'kkp18')
                              and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date + 3
                              and (starts_at at time zone 'Asia/Kuala_Lumpur')::time = '09:00')], 'Cuti') ->> 'deleted')::int,
  1, 'an unbooked slot is deleted');
select is(
  (public.remove_slots(array['e1000000-0000-0000-0000-00000000000b'::uuid], 'Pegawai bercuti') ->> 'cancelled')::int,
  1, 'a booked slot is blocked and its booking cancelled');

-- Others
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select is(
  (select count(*) from public.officer_venues(current_date - 1, (now() at time zone 'Asia/Kuala_Lumpur')::date + 30))::int,
  0, 'another officer sees no venues from this officer''s calendar');
select throws_ok(
  $$ select public.remove_slots(array['e1000000-0000-0000-0000-00000000000a'::uuid], null) $$,
  'not_allowed', 'another officer cannot remove this officer''s slots');
select is((public.officer_dashboard() ->> 'students_total')::int, 0,
  'another officer''s numbers do not include this officer''s children');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
select throws_ok(
  $$ select public.add_slots((select id from public.locations where slug = 'kkp18'), null, (now() at time zone 'Asia/Kuala_Lumpur')::date + 3, '09:00', '10:00', 15, 1) $$,
  'not_allowed', 'a parent cannot add slots');

select * from finish();
rollback;
