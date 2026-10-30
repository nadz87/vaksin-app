-- Vaksin App: the officer's upcoming slots list (Tetapan > Jenis temujanji) and removing a
-- date's slots from it with remove_slots.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'parent@upcoming.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'officer@upcoming.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'other@upcoming.test');
update public.profiles set role = 'officer', full_name = 'Officer Upcoming', job_title = 'Nurse'
where user_id in ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');

insert into public.schools (id, name, slug) values
  ('20000000-0000-0000-0000-0000000000f1', 'Upcoming School', 'upcoming-school');
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('30000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'Child Upcoming', '2014-01-01', 'male', '6B', '0021');
insert into public.student_guardians (student_id, guardian_id) values
  ('30000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1');

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
create function pg_temp.kkp18() returns uuid language sql as $$
  select id from public.locations where slug = 'kkp18'
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.type_id(text), pg_temp.kl_day(int), pg_temp.kkp18() to authenticated;

-- Slots that must not show: no type, in the past, another officer's.
insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id) values
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.kkp18(), now() + interval '6 days', now() + interval '6 days 15 minutes', 1, null),
  ('00000000-0000-0000-0000-0000000000f2', pg_temp.kkp18(), now() - interval '2 days', now() - interval '2 days' + interval '15 minutes', 1, pg_temp.type_id('hpv')),
  ('00000000-0000-0000-0000-0000000000f3', pg_temp.kkp18(), now() + interval '7 days', now() + interval '7 days 15 minutes', 1, pg_temp.type_id('hpv'));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$ select * from public.officer_upcoming_slots() $$, 'not_allowed', 'a parent cannot list slots');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select is(public.add_slots(pg_temp.kkp18(), pg_temp.type_id('hpv'), pg_temp.kl_day(3), '09:00', '09:30', 15, 1), 2,
  'officer adds two HPV slots');
select is(public.add_slots(pg_temp.kkp18(), pg_temp.type_id('att'), pg_temp.kl_day(4), '09:00', '09:15', 15, 1), 1,
  'and one ATT slot the next day');
select is((select count(*) from public.officer_upcoming_slots())::int, 3,
  'only their own upcoming typed slots are listed');
select is((select count(*) from public.officer_upcoming_slots() where appointment_type_id = pg_temp.type_id('hpv'))::int, 2,
  'two of them are HPV');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select ok(public.book_slot(
  (select id from public.slots where officer_id = '00000000-0000-0000-0000-0000000000f2'
     and appointment_type_id = pg_temp.type_id('hpv') and starts_at > now() order by starts_at limit 1),
  '30000000-0000-0000-0000-0000000000f1', pg_temp.type_id('hpv'), null) is not null,
  'parent books the first HPV slot');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select is((select sum(booked) from public.officer_upcoming_slots() where appointment_type_id = pg_temp.type_id('hpv'))::int, 1,
  'the list shows the booking');

-- The date's trash button: remove_slots on every HPV slot of that day.
select is(public.remove_slots(
  (select array_agg(id) from public.officer_upcoming_slots()
   where appointment_type_id = pg_temp.type_id('hpv') and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = pg_temp.kl_day(3)),
  null),
  '{"deleted": 1, "blocked": 1, "cancelled": 1}'::jsonb,
  'removing the date deletes the empty slot and cancels the booked one');
select is((select count(*) from public.officer_upcoming_slots())::int, 1,
  'only the ATT slot is left in the list');

select * from finish();
rollback;
