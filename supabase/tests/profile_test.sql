-- Vaksin App: child ID and parent address rules.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'parent@profile.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'other.parent@profile.test');
insert into public.schools (id, name, slug) values
  ('70000000-0000-0000-0000-00000000000a', 'Profile School', 'profile-school');
insert into public.parent_schools values
  ('00000000-0000-0000-0000-0000000000a5', '70000000-0000-0000-0000-00000000000a');

-- Child ID: assigned by the database, even if the caller tries to set one.
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4, student_no) values
  ('80000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', 'Child One', '2016-01-01', 'male', '3A', '0001', 'VK-99-999999'),
  ('80000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000a', 'Child Two', '2016-02-02', 'female', '3B', '0002', null);
insert into public.student_guardians (student_id, guardian_id) values
  ('80000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a5');

select matches(
  (select student_no from public.students where id = '80000000-0000-0000-0000-00000000000a'),
  '^VK-[0-9]{2}-[0-9]{6}$', 'every child gets an ID like VK-26-000001');

select isnt(
  (select student_no from public.students where id = '80000000-0000-0000-0000-00000000000a'),
  'VK-99-999999', 'an ID supplied by the caller is ignored');

select isnt(
  (select student_no from public.students where id = '80000000-0000-0000-0000-00000000000a'),
  (select student_no from public.students where id = '80000000-0000-0000-0000-00000000000b'),
  'two children never share an ID');

-- Parent -------------------------------------------------------------------
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a5');

select throws_ok(
  $$ update public.students set student_no = 'VK-26-000777' where id = '80000000-0000-0000-0000-00000000000a' $$,
  'school, MyKid, birth details and child ID cannot be changed here', 'a parent cannot change a child ID');

select lives_ok(
  $$ update public.profiles set full_name = 'Parent Five', phone = '+60123456789',
       address_line1 = 'No 12, Jalan Putra 3', address_line2 = 'Presint 8', postcode = '62250',
       city = 'Putrajaya', state = 'W.P. Putrajaya' where user_id = auth.uid() $$,
  'a parent can save a complete address');

select is(
  (select city from public.profiles where user_id = auth.uid()), 'Putrajaya', 'the address is saved');

select throws_ok(
  $$ update public.profiles set address_line1 = null where user_id = auth.uid() $$,
  '23514', null, 'a half-filled address is refused (all or nothing)');

select throws_ok(
  $$ update public.profiles set postcode = '6225' where user_id = auth.uid() $$,
  '23514', null, 'postcode must be 5 digits');

select throws_ok(
  $$ update public.profiles set state = 'Atlantis' where user_id = auth.uid() $$,
  '23514', null, 'state must be a real Malaysian state');

select lives_ok(
  $$ update public.profiles set address_line1 = null, address_line2 = null, postcode = null, city = null, state = null
     where user_id = auth.uid() $$,
  'a parent can clear the whole address');

-- Editing a child ------------------------------------------------------------
select lives_ok(
  $$ update public.students set full_name = 'Child One Edited', class_name = '3B', blood_group = 'O+',
       height_cm = 130.5, weight_kg = 28, allergies = 'Kacang', conditions = 'Asma', medications = 'Ventolin',
       emergency_contact_name = 'Nenek', emergency_contact_phone = '+60123456789'
     where id = '80000000-0000-0000-0000-00000000000a' $$,
  'a parent can edit their child''s name, class, health details and emergency contact');

select throws_ok(
  $$ update public.students set date_of_birth = '2015-05-05' where id = '80000000-0000-0000-0000-00000000000a' $$,
  'school, MyKid, birth details and child ID cannot be changed here', 'date of birth is locked (it comes from the MyKid)');

select throws_ok(
  $$ update public.students set gender = 'female' where id = '80000000-0000-0000-0000-00000000000a' $$,
  'school, MyKid, birth details and child ID cannot be changed here', 'gender is locked (it comes from the MyKid)');

select throws_ok(
  $$ update public.students set emergency_contact_phone = '03-1234 5678' where id = '80000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'emergency contact must be a Malaysian mobile number');

select throws_ok(
  $$ update public.students set blood_group = 'Z+' where id = '80000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'blood group must be a real one');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a6');
update public.students set allergies = 'hacked' where id = '80000000-0000-0000-0000-00000000000a';  -- matches no rows for this parent
reset role;
select is(
  (select allergies from public.students where id = '80000000-0000-0000-0000-00000000000a'),
  'Kacang', 'a parent who is not the guardian cannot edit the child');

select * from finish();
rollback;
