-- Vaksin App: the platform admin manages health officers (admin page).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d4', 'admin@oa.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'parent.with.child@oa.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'parent.no.child@oa.test');
update public.profiles set role = 'platform_admin' where user_id = '00000000-0000-0000-0000-0000000000d4';

insert into public.schools (id, name, slug) values ('90000000-0000-0000-0000-0000000000a4', 'OA School', 'oa-school');
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4)
values ('a0000000-0000-0000-0000-0000000000a4', '90000000-0000-0000-0000-0000000000a4', 'OA Child', '2016-01-01', 'male', '3A', '0001');
insert into public.student_guardians (student_id, guardian_id, relationship, consent_at)
values ('a0000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a4', 'mother', now());

create function pg_temp.act_as(p_user uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
-- Runs as the test owner: signed-in users cannot read auth.users themselves.
create function pg_temp.officer_id(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email
$$;
grant execute on function pg_temp.act_as(uuid, text), pg_temp.officer_id(text) to authenticated;

-- Who may see the list --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4', 'aal1');
select throws_ok($$ select * from public.admin_officers() $$, 'not_allowed', 'admin without 2-step cannot list officers');

-- Invitations (the sign-in service calls this as vaksin_auth) ----------------------
select throws_ok($$ select * from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', 'x@oa.test') $$,
  '42501', null, 'signed-in users cannot call the invitation function directly');
reset role;
select throws_ok($$ select * from auth_private.invite_officer('00000000-0000-0000-0000-0000000000a5', 'x@oa.test') $$,
  'not_allowed', 'only a platform admin can invite');
select is((select already_registered from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', '  New.Officer@OA.test ')),
  false, 'admin invites a new officer (email trimmed and lower-cased)');
select throws_ok($$ select * from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', 'not-an-email') $$,
  'invalid_email', 'bad email refused');
select throws_ok($$ select * from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', 'admin@oa.test') $$,
  'already_admin', 'an admin cannot be turned into an officer');
select throws_ok($$ select * from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', 'parent.with.child@oa.test') $$,
  'email_is_parent', 'a parent with registered children cannot be turned into an officer');
select is((select count(*)::int from auth_private.invite_officer('00000000-0000-0000-0000-0000000000d4', 'parent.no.child@oa.test')),
  1, 'an account with no children can become an officer');

select results_eq(
  $$ select p.role::text, p.full_name, p.job_title from public.profiles p join auth.users u on u.id = p.user_id
      where u.email = 'new.officer@oa.test' $$,
  $$ values ('officer', null::text, null::text) $$,
  'invited: officer role; name and job title come from the officer later');
select is((select count(*)::int from public.audit_log where action = 'invite_officer'), 2, 'both invitations are audit-logged');
select is((select password_hash from auth.users where email = 'new.officer@oa.test'), null, 'officers get no password');

-- Listing, schools ----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select is((select count(*)::int from public.admin_officers()), 2, 'admin sees both officers');
select results_eq(
  $$ select active, two_step, schools from public.admin_officers() where email = 'new.officer@oa.test' $$,
  $$ values (true, false, '[]'::jsonb) $$,
  'new officer: active, 2-step not set up, no schools');
-- Officers choose their own schools -----------------------------------------
select pg_temp.act_as(pg_temp.officer_id('new.officer@oa.test'), 'aal1');
select throws_ok($$ select public.officer_join_school('90000000-0000-0000-0000-0000000000a4') $$,
  'not_allowed', 'an officer without 2-step cannot choose schools');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.officer_join_school('90000000-0000-0000-0000-0000000000a4') $$,
  'not_allowed', 'a parent cannot choose officer schools');

select pg_temp.act_as(pg_temp.officer_id('new.officer@oa.test'));
select public.officer_join_school('90000000-0000-0000-0000-0000000000a4');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select is((select jsonb_array_length(schools) from public.admin_officers() where email = 'new.officer@oa.test'), 1,
  'the school the officer chose shows on the admin page');

-- A booked child at that school: leaving is refused until the booking is gone.
reset role;
insert into public.slots (id, officer_id, school_id, starts_at, ends_at, capacity) values
  ('b0000000-0000-0000-0000-0000000000a4', pg_temp.officer_id('new.officer@oa.test'), '90000000-0000-0000-0000-0000000000a4',
   now() + interval '2 days', now() + interval '2 days 15 minutes', 1),
  ('b0000000-0000-0000-0000-0000000000a5', pg_temp.officer_id('new.officer@oa.test'), '90000000-0000-0000-0000-0000000000a4',
   now() + interval '3 days', now() + interval '3 days 15 minutes', 1);
insert into public.appointments (id, slot_id, student_id, type_id, booked_by)
select 'c0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a4',
       t.id, '00000000-0000-0000-0000-0000000000a4'
  from public.appointment_types t where t.code = 'screening';

select pg_temp.act_as(pg_temp.officer_id('new.officer@oa.test'));
select throws_ok($$ select public.officer_leave_school('90000000-0000-0000-0000-0000000000a4') $$,
  'school_has_bookings', 'cannot leave a school while a child has an upcoming appointment there');

reset role;
update public.appointments set status = 'cancelled' where id = 'c0000000-0000-0000-0000-0000000000a4';
select pg_temp.act_as(pg_temp.officer_id('new.officer@oa.test'));
select public.officer_leave_school('90000000-0000-0000-0000-0000000000a4');
reset role;
select is((select count(*)::int from public.officer_schools where officer_id = pg_temp.officer_id('new.officer@oa.test')), 0,
  'after the booking is cancelled the officer can leave');
select is((select count(*)::int from public.slots where id = 'b0000000-0000-0000-0000-0000000000a5'), 0,
  'leaving deletes unused future slots');
select is((select status::text from public.slots where id = 'b0000000-0000-0000-0000-0000000000a4'), 'blocked',
  'a future slot with past (cancelled) bookings is blocked, so parents cannot book it');

-- Disable / enable, reset 2-step ------------------------------------------------
reset role;
insert into auth_private.sessions (user_id, expires_at) values (pg_temp.officer_id('new.officer@oa.test'), now() + interval '1 hour');
insert into auth_private.mfa_factors (user_id, secret_enc, verified_at) values (pg_temp.officer_id('new.officer@oa.test'), '\x00', now());

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select is((select two_step from public.admin_officers() where email = 'new.officer@oa.test'), true, 'finished 2-step shows as on');
select public.admin_set_officer_active(pg_temp.officer_id('new.officer@oa.test'), false);
select is((select active from public.admin_officers() where email = 'new.officer@oa.test'), false, 'officer disabled');
reset role;
select is((select count(*)::int from auth_private.sessions where user_id = pg_temp.officer_id('new.officer@oa.test') and revoked_at is null), 0,
  'disabling signs them out everywhere');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select public.admin_set_officer_active(pg_temp.officer_id('new.officer@oa.test'), true);
select is((select active from public.admin_officers() where email = 'new.officer@oa.test'), true, 'officer enabled again');
select public.admin_reset_officer_two_step(pg_temp.officer_id('new.officer@oa.test'));
select is((select two_step from public.admin_officers() where email = 'new.officer@oa.test'), false, '2-step reset');

select throws_ok($$ select public.admin_set_officer_active('00000000-0000-0000-0000-0000000000d4', false) $$,
  'not_officer', 'the admin page cannot disable an admin');
select throws_ok($$ select public.admin_reset_officer_two_step('00000000-0000-0000-0000-0000000000a4') $$,
  'not_officer', 'the admin page cannot reset a parent');

select * from finish();
rollback;
