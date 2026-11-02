-- Vaksin App: one slot shared by several appointment types. The owner's example: two places at
-- 9:00, Mardhiyyah for one injection and Safeeya for another.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f101', 'parent@mixed.test'),
  ('00000000-0000-0000-0000-00000000f102', 'officer@mixed.test');
update public.profiles set role = 'officer', full_name = 'Officer Mixed', job_title = 'Nurse'
where user_id = '00000000-0000-0000-0000-00000000f102';

insert into public.schools (id, name, slug) values
  ('20000000-0000-0000-0000-00000000f101', 'Mixed School', 'mixed-school');
insert into public.students (id, school_id, full_name, date_of_birth, gender, class_name, mykid_last4) values
  ('30000000-0000-0000-0000-00000000f101', '20000000-0000-0000-0000-00000000f101', 'Mardhiyyah', '2014-01-01', 'female', '6A', '0031'),
  ('30000000-0000-0000-0000-00000000f102', '20000000-0000-0000-0000-00000000f101', 'Safeeya', '2014-02-01', 'female', '6A', '0032'),
  ('30000000-0000-0000-0000-00000000f103', '20000000-0000-0000-0000-00000000f101', 'Anak Ketiga', '2014-03-01', 'male', '6A', '0033');
insert into public.student_guardians (student_id, guardian_id)
select id, '00000000-0000-0000-0000-00000000f101' from public.students where school_id = '20000000-0000-0000-0000-00000000f101';

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
create function pg_temp.shared_slot() returns uuid language sql as $$
  select id from public.slots where officer_id = '00000000-0000-0000-0000-00000000f102'
  and capacity = 2
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.type_id(text), pg_temp.kl_day(int), pg_temp.kkp18(), pg_temp.shared_slot() to authenticated;

-- Three officer-made types, so removing them later touches only this test's slots.
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select public.add_appointment_type('Suntikan Uji A'), public.add_appointment_type('Suntikan Uji B'), public.add_appointment_type('Suntikan Uji C');

select is(public.add_slots_for_types(pg_temp.kkp18(), array[pg_temp.type_id('custom-suntikan-uji-a'), pg_temp.type_id('custom-suntikan-uji-b')],
                                     pg_temp.kl_day(3), '09:00', '09:15', 15, 2), 1,
  'one 9:00 slot for types A and B, with 2 places');
select throws_ok(format($$ select public.add_slots_for_types(%L, '{}', %L, '09:00', '09:15', 15, 2) $$, pg_temp.kkp18(), pg_temp.kl_day(3)),
  'bad_type', 'a slot needs at least one type');
select throws_ok(format($$ select public.add_slots_for_types(%L, array[gen_random_uuid()], %L, '09:00', '09:15', 15, 2) $$, pg_temp.kkp18(), pg_temp.kl_day(3)),
  'bad_type', 'an unknown type is refused');

-- Parents book a mix ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select is((select cardinality(appointment_type_ids) from public.available_slots('30000000-0000-0000-0000-00000000f101') where id = pg_temp.shared_slot()), 2,
  'the parent sees the slot offered for both types');
select ok(public.book_slot(pg_temp.shared_slot(), '30000000-0000-0000-0000-00000000f101', pg_temp.type_id('custom-suntikan-uji-a'), null) is not null,
  'Mardhiyyah books type A at 9:00');
select ok(public.book_slot(pg_temp.shared_slot(), '30000000-0000-0000-0000-00000000f102', pg_temp.type_id('custom-suntikan-uji-b'), null) is not null,
  'Safeeya books type B in the same slot');
select throws_ok(format($$ select public.book_slot(%L, '30000000-0000-0000-0000-00000000f103', %L, null) $$, pg_temp.shared_slot(), pg_temp.type_id('custom-suntikan-uji-c')),
  'type_mismatch', 'a type the slot does not take is refused');
select throws_ok(format($$ select public.book_slot(%L, '30000000-0000-0000-0000-00000000f103', %L, null) $$, pg_temp.shared_slot(), pg_temp.type_id('custom-suntikan-uji-a')),
  'slot_full', 'the 2 places are shared: a third child is refused');

-- Officer: overlap rules -----------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select is((select array_length(appointment_type_ids, 1) || '/' || booked from public.officer_slots(pg_temp.kl_day(3), pg_temp.kl_day(3)) where id = pg_temp.shared_slot()), '2/2',
  'the officer sees both types and both bookings on the slot');
select is(public.add_slots_for_types(pg_temp.kkp18(), array[pg_temp.type_id('custom-suntikan-uji-a')], pg_temp.kl_day(3), '09:00', '09:15', 15, 1), 0,
  'type A alone at 9:00 adds nothing: the shared slot already takes it');
select is(public.add_slots_for_types(pg_temp.kkp18(), array[pg_temp.type_id('custom-suntikan-uji-b'), pg_temp.type_id('custom-suntikan-uji-c')], pg_temp.kl_day(3), '09:00', '09:15', 15, 1), 0,
  'types B and C together add nothing: B is already taken at 9:00');
select is(public.add_slots_for_types(pg_temp.kkp18(), array[pg_temp.type_id('custom-suntikan-uji-c')], pg_temp.kl_day(3), '09:00', '09:15', 15, 1), 1,
  'type C alone at 9:00 is fine');
select throws_ok(format($$ insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_ids)
                           select officer_id, location_id, starts_at, ends_at, 1, %L::uuid[] from public.slots where id = %L $$,
                        array[pg_temp.type_id('custom-suntikan-uji-a')], pg_temp.shared_slot()),
  'slot_overlap', 'the rule also holds for a direct insert');

-- Removing one type of a shared slot -----------------------------------------------------------
select is(public.remove_appointment_type(pg_temp.type_id('custom-suntikan-uji-a')), '{"cancelled": 1, "removed": 0}'::jsonb,
  'removing type A cancels only its booking; the slot stays for type B');
select is((select count(*) from public.slots s where s.id = pg_temp.shared_slot() and s.status = 'open'
           and s.appointment_type_ids = array[pg_temp.type_id('custom-suntikan-uji-b')])::int, 1,
  'the slot is still open, for type B only');
reset role;
select is((select string_agg(st.full_name || ':' || a.status::text, ',' order by st.full_name) from public.appointments a
           join public.students st on st.id = a.student_id where a.slot_id = pg_temp.shared_slot()),
  'Mardhiyyah:cancelled,Safeeya:booked', 'Mardhiyyah is cancelled, Safeeya keeps her place');

-- Removing the last type it takes closes the slot, as for a single-type slot.
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select is(public.remove_appointment_type(pg_temp.type_id('custom-suntikan-uji-b')), '{"cancelled": 1, "removed": 0}'::jsonb,
  'removing type B cancels Safeeya too');
select is((select status::text from public.slots where id = pg_temp.shared_slot()), 'blocked',
  'the slot is closed once none of its types is offered');
select is((select count(*) from public.officer_upcoming_slots() where id = pg_temp.shared_slot())::int, 0,
  'and it leaves the upcoming list');

select * from finish();
rollback;
