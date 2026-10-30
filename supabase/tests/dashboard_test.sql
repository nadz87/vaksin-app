-- Vaksin App: officer dashboard (student list, patient profile, export data, audit log).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'parent@dash.test'),
  ('00000000-0000-0000-0000-0000000000a8', 'second.parent@dash.test'),
  ('00000000-0000-0000-0000-0000000000c7', 'officer@dash.test'),
  ('00000000-0000-0000-0000-0000000000c8', 'other.officer@dash.test');
update public.profiles set role = 'officer'
where user_id in ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c8');
update public.profiles set full_name = 'Puan Satu', phone = '+60123456789',
  address_line1 = 'No 1 Jalan A', postcode = '62250', city = 'Putrajaya', state = 'W.P. Putrajaya'
where user_id = '00000000-0000-0000-0000-0000000000a7';
update public.profiles set full_name = 'Encik Dua', phone = '+60129876543'
where user_id = '00000000-0000-0000-0000-0000000000a8';

insert into public.schools (id, name, slug) values
  ('90000000-0000-0000-0000-00000000000a', 'Dash School A', 'dash-school-a'),
  ('90000000-0000-0000-0000-00000000000b', 'Dash School B', 'dash-school-b');
insert into public.officer_schools values
  ('00000000-0000-0000-0000-0000000000c7', '90000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000c8', '90000000-0000-0000-0000-00000000000b');

insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4, blood_group, allergies) values
  ('a0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-00000000000a', 'Dash Child', '2016-01-01', 'male', '3A', '0001', 'O+', 'Kacang');
insert into public.student_identifiers values ('a0000000-0000-0000-0000-00000000000a', '160101101231');
insert into public.student_guardians (student_id, guardian_id, relationship, consent_at) values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a7', 'mother', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a8', 'father', now() - interval '1 day');

insert into public.slots (id, officer_id, location_id, starts_at, ends_at, capacity) values
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c7', (select id from public.locations where slug = 'kkp18'),
   now() + interval '3 days', now() + interval '3 days 15 minutes', 1);
insert into public.appointments (slot_id, student_id, type_id, booked_by, reason_note)
select 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', t.id,
       '00000000-0000-0000-0000-0000000000a7', 'Batuk'
from public.appointment_types t where t.code = 'screening';

create function pg_temp.act_as(p_user uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;

-- Officer c7 has the child booked in one of their slots --------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');

select is((select count(*) from public.officer_students())::int, 1,
  'officer sees the children booked into their slots');

select is((select parent_name from public.officer_students()),
  'Puan Satu', 'the list shows the first parent');

select is((select upcoming from public.officer_students()), 1,
  'the list counts upcoming bookings');

select is(
  jsonb_array_length(public.officer_student_profile('a0000000-0000-0000-0000-00000000000a') -> 'guardians'), 2,
  'the profile lists both parents');

select is(
  public.officer_student_profile('a0000000-0000-0000-0000-00000000000a') -> 'guardians' -> 0 ->> 'address_line1',
  'No 1 Jalan A', 'the profile includes the parent''s address');

select is(
  public.officer_student_profile('a0000000-0000-0000-0000-00000000000a') -> 'student' ->> 'mykid_last4',
  '0001', 'the profile shows only the last 4 digits of the MyKid');

select is((select count(*) from public.audit_log where action = 'view_profile')::int, 3,
  'each profile view is logged');

select is((select count(*) from public.export_students(false) where mykid is null)::int, 1,
  'the student export leaves the MyKid out by default');

select is((select mykid from public.export_students(true)),
  '160101101231', 'the full MyKid is included only when asked for');

select is((select count(*) from public.audit_log where action = 'export_students' and (meta ->> 'include_mykid')::boolean)::int, 1,
  'an export with the MyKid is logged as such');

select is((select count(*) from public.export_appointments(current_date - 1, current_date + 30))::int, 1,
  'the appointment export lists the booking');

-- Everyone else -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c8');
select throws_ok(
  $$ select public.officer_student_profile('a0000000-0000-0000-0000-00000000000a') $$,
  'not_allowed', 'an officer the child has not booked with cannot open the profile');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select * from public.export_students(true) $$,
  'not_allowed', 'a parent cannot export');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7', 'aal1');
select throws_ok(
  $$ select * from public.officer_students() $$,
  'not_allowed', 'an officer token without staff level sees nothing');

select * from finish();
rollback;
