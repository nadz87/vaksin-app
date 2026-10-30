-- Vaksin App: officer calendar rules (schedule, generate, days off, blocking) at locations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'parent@cal.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'officer@cal.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'other.officer@cal.test');
update public.profiles set role = 'officer'
where user_id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4');

-- Location A = KK P18 (Sat-Sun weekend, from the migration); location B has a Fri-Sat weekend.
insert into public.locations (id, name, slug, weekend_days) values
  ('51000000-0000-0000-0000-00000000000b', 'Cal Clinic B', 'cal-clinic-b', '{5,6}');
insert into public.schools (id, name, slug) values
  ('50000000-0000-0000-0000-00000000000a', 'Cal School A', 'cal-school-a');
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('60000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'Cal Child', '2016-01-01', 'male', '3A', '0003');
insert into public.student_guardians (student_id, guardian_id) values
  ('60000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3');

create function pg_temp.act_as(p_user uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
create function pg_temp.kk() returns uuid language sql as $$
  select id from public.locations where slug = 'kkp18'
$$;
grant execute on function pg_temp.act_as(uuid, text), pg_temp.kk() to authenticated;

-- Officer c3 --------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');

select lives_ok(
  $$ insert into public.availability_rules (officer_id, location_id, weekday, start_time, end_time, slot_minutes, capacity)
     values ('00000000-0000-0000-0000-0000000000c3', pg_temp.kk(), 1, '08:00', '09:00', 15, 1) $$,
  'officer adds Monday 08:00-09:00 at KK P18');

select throws_ok(
  $$ insert into public.availability_rules (officer_id, location_id, weekday, start_time, end_time, slot_minutes, capacity)
     values ('00000000-0000-0000-0000-0000000000c3', '51000000-0000-0000-0000-00000000000b', 1, '08:30', '09:30', 15, 1) $$,
  'rule_overlap', 'same officer cannot be at clinic B while scheduled at KK P18');

select throws_ok(
  $$ insert into public.availability_rules (officer_id, location_id, weekday, start_time, end_time, slot_minutes, capacity)
     values ('00000000-0000-0000-0000-0000000000c3', pg_temp.kk(), 6, '08:00', '09:00', 15, 1) $$,
  'weekend_day', 'no schedule on the location''s weekend (Saturday at KK P18)');

select lives_ok(
  $$ insert into public.availability_rules (officer_id, location_id, weekday, start_time, end_time, slot_minutes, capacity)
     values ('00000000-0000-0000-0000-0000000000c3', '51000000-0000-0000-0000-00000000000b', 7, '08:00', '09:00', 30, 1) $$,
  'Sunday is a working day at clinic B (Fri-Sat weekend)');

select cmp_ok(public.generate_my_slots(3), '>', 0, 'generate creates slots for the next 3 weeks');
select is(public.generate_my_slots(3), 0, 'running generate again adds nothing (no duplicates)');

select is(
  (select count(distinct (starts_at at time zone 'Asia/Kuala_Lumpur')::time) from public.slots
   where location_id = pg_temp.kk()),
  4::bigint, 'Monday 08:00-09:00 in 15-minute steps gives 4 start times');

-- Day off: book a child on the first slot, take that day off, the booking is cancelled
reset role;
insert into public.appointments (slot_id, student_id, type_id, booked_by)
select s.id, '60000000-0000-0000-0000-00000000000a',
       (select id from public.appointment_types where code = 'screening'),
       '00000000-0000-0000-0000-0000000000a3'
from public.slots s where s.location_id = (select id from public.locations where slug = 'kkp18')
order by s.starts_at limit 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');

select is(
  public.add_closure(
    (select (min(starts_at) at time zone 'Asia/Kuala_Lumpur')::date from public.slots where location_id = pg_temp.kk()),
    'Cuti'),
  1, 'a day off cancels the one booking on it');

select is(
  (select count(*) from public.slots where location_id = pg_temp.kk() and status = 'blocked')::int,
  4, 'all 4 of the officer''s slots that day are blocked');

select cmp_ok(
  (select count(*) from public.officer_slots(current_date, current_date + 30) where status = 'open'), '>', 0::bigint,
  'officer calendar still lists the other open slots');

select is(public.generate_my_slots(3), 0, 'regenerating does not recreate slots on a day off');

-- Other officer + parent --------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');
select throws_ok(
  $$ select public.set_slot_blocked((select id from public.slots where location_id = pg_temp.kk() limit 1), true, null) $$,
  'not_allowed', 'an officer cannot block another officer''s slots');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ select public.generate_my_slots(2) $$,
  'not_allowed', 'a parent cannot generate slots');

select ok(
  (select cancelled_by_officer from public.my_appointments() limit 1),
  'parent sees the booking was cancelled by the officer');

-- An aal1 token (not a finished staff sign-in) ----------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', 'aal1');
select throws_ok(
  $$ select public.generate_my_slots(2) $$,
  'not_allowed', 'an officer token without staff level cannot generate slots');

select * from finish();
rollback;
