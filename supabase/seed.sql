-- Local/demo seed data only. Never put real student data here.

-- Schools and the default location (Klinik Kesihatan Putrajaya P18) come from the migrations.

-- Demo health officer (no password: signs in with an emailed code like every officer).
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000aaaa', 'pegawai.demo@test.local')
on conflict (id) do nothing;

update public.profiles set role = 'officer', full_name = 'Pegawai Demo', job_title = 'Jururawat Kesihatan, KK Putrajaya P18'
where user_id = '00000000-0000-0000-0000-00000000aaaa';

-- Demo timetable for the next 3 weeks (Malaysia time) at KK Putrajaya P18:
--   weekdays 08:00-11:00, 15-minute slots for any appointment type (1 child each);
--   Fridays 14:00 and 14:30, vaccination group sessions (10 children each).
insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id)
select '00000000-0000-0000-0000-00000000aaaa', l.id,
       (d::date + time '08:00' + q * interval '15 minutes') at time zone 'Asia/Kuala_Lumpur',
       (d::date + time '08:15' + q * interval '15 minutes') at time zone 'Asia/Kuala_Lumpur',
       1, null
from public.locations l
cross join generate_series(current_date + 1, current_date + 21, interval '1 day') as d  -- d::date: keep it a local date
cross join generate_series(0, 11) as q
where l.slug = 'kkp18' and extract(isodow from d) between 1 and 5
on conflict do nothing;

insert into public.slots (officer_id, location_id, starts_at, ends_at, capacity, appointment_type_id)
select '00000000-0000-0000-0000-00000000aaaa', l.id,
       (d::date + t) at time zone 'Asia/Kuala_Lumpur',
       (d::date + t + interval '30 minutes') at time zone 'Asia/Kuala_Lumpur',
       10, (select id from public.appointment_types where code = 'vaccination')
from public.locations l
cross join generate_series(current_date + 1, current_date + 21, interval '1 day') as d  -- d::date: keep it a local date
cross join (values (time '14:00'), (time '14:30')) as v(t)
where l.slug = 'kkp18' and extract(isodow from d) = 5
on conflict do nothing;
