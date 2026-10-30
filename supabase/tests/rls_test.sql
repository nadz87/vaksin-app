-- Vaksin App: security rule tests. Run with `npm run db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Fixtures ----------------------------------------------------------------
-- Users (the auth trigger creates a 'parent' profile for each).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'parent.a@rls.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'parent.b@rls.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'officer@rls.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin@rls.test');

update public.profiles set role = 'officer'        where user_id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'platform_admin' where user_id = '00000000-0000-0000-0000-0000000000d1';

insert into public.schools (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Test School A', 'test-school-a'),
  ('10000000-0000-0000-0000-000000000002', 'Test School B', 'test-school-b');

-- Officer serves school A only.
insert into public.officer_schools values
  ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001');

-- Helper to act as a user. aal = 'aal2' means "passed 2FA".
create function pg_temp.act_as(p_user uuid, p_aal text default 'aal1') returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Parent A joins school A and registers a child -------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.join_school('no-such-school') $$,
  'school_not_found', 'unknown school is rejected');

select lives_ok(
  $$ select public.join_school('test-school-a') $$,
  'parent joins a school by picking it, no code needed');

select throws_ok(
  $$ select public.register_child('10000000-0000-0000-0000-0000000000ff', 'Ali', '150312101235',
       '2015-03-12', 'male', '4 Bestari', 'father', true) $$,
  'school_not_found', 'cannot register a child at an unknown or hidden school');

select throws_ok(
  $$ select public.register_child('10000000-0000-0000-0000-000000000001', 'Ali', '150312101234',
       '2015-03-12', 'male', '4 Bestari', 'father', true) $$,
  'mykid_gender_mismatch', 'gender must match the MyKid last digit');

select is(
  (public.register_child('10000000-0000-0000-0000-000000000001', 'Ali', '150312-10-1235',
     '2015-03-12', 'male', '4 Bestari', 'father', true)) ->> 'status',
  'created', 'parent A registers a child (dashes in MyKid are fine)');

select is((select count(*) from public.students)::int, 1, 'parent A sees own child');

select throws_ok(
  $$ update public.students set school_id = '10000000-0000-0000-0000-000000000002' $$,
  'school, MyKid, birth details and child ID cannot be changed here', 'parent cannot move a child to another school');

select lives_ok(
  $$ update public.students set allergies = 'Kacang' $$,
  'parent can update own child''s health details');

select is((select count(*) from public.student_identifiers)::int, 0,
  'full MyKid table is never readable directly');

-- Parent B -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select public.join_school('test-school-a');

select is((select count(*) from public.students)::int, 0, 'parent B cannot see parent A''s child');

select is(
  (public.register_child('10000000-0000-0000-0000-000000000001', 'Ali Copy', '150312101235',
     '2015-03-12', 'male', '4 Bestari', 'mother', true)) ->> 'status',
  'request_pending', 'duplicate MyKid becomes a link request, child details stay hidden');

select is((select count(*) from public.students)::int, 0, 'still hidden after the request');

select throws_ok(
  $$ update public.profiles set role = 'platform_admin' where user_id = auth.uid() $$,
  'role can only be changed by a platform admin', 'parent cannot promote themselves');

select lives_ok(
  $$ update public.profiles set full_name = 'Parent B', phone = '+60123456789' where user_id = auth.uid() $$,
  'parent can save own name and phone (complete profile step)');

select throws_ok(
  $$ update public.profiles set phone = '03-1234 5678' where user_id = auth.uid() $$,
  '23514', null, 'phone must be a normalised Malaysian mobile number');

-- Officer -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'aal1');
select is((select count(*) from public.students)::int, 0, 'an officer token without staff level sees no students');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'aal2');
select is((select count(*) from public.students)::int, 0, 'an officer sees no child before the child books with them');

-- The child books one of the officer's slots at KK P18.
reset role;
insert into public.slots (id, officer_id, location_id, starts_at, ends_at, capacity) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
   (select id from public.locations where slug = 'kkp18'), now() + interval '3 days', now() + interval '3 days 15 minutes', 1);
insert into public.appointments (slot_id, student_id, type_id, booked_by)
select '11000000-0000-0000-0000-000000000001', (select id from public.students limit 1), t.id, '00000000-0000-0000-0000-0000000000a1'
  from public.appointment_types t where t.code = 'screening';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1', 'aal2');
select is((select count(*) from public.students)::int, 1, 'after booking, the officer sees that child');

select is(public.reveal_mykid((select id from public.students limit 1)), '150312101235',
  'officer can reveal the full MyKid');

select is((select count(*) from public.audit_log where action = 'reveal_mykid')::int, 1,
  'the reveal was logged');

-- Platform admin -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1', 'aal2');
select is((select count(*) from public.students)::int, 0,
  'platform admin manages officers but cannot read student data');

select * from finish();
rollback;
