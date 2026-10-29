-- Local/demo seed data only. Never put real student data here.

-- Schools come from the migration (Putrajaya list). Demo slots cover ALL schools.

-- Demo health officer (no password: cannot sign in; only owns the demo slots).
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000aaaa', 'pegawai.demo@test.local')
on conflict (id) do nothing;

update public.profiles set role = 'officer', full_name = 'Pegawai Demo'
where user_id = '00000000-0000-0000-0000-00000000aaaa';

insert into public.officer_schools (officer_id, school_id)
select '00000000-0000-0000-0000-00000000aaaa', id from public.schools
on conflict do nothing;

-- Demo timetable for the next 3 weeks (Malaysia time). ONE officer visits every
-- school, so each school gets one hour a week (4 x 15 min, any type, 1 child).
-- 27 schools fit into Mon-Fri x 08:00-14:00 (30 blocks), so the officer is
-- never in two places at once (the database would refuse an overlap anyway).
--   block number i (schools sorted by name):  weekday = i % 5 + 1,  hour = 8 + i / 5
-- Plus Friday 14:00 and 14:30 vaccination group sessions (10 children) at
-- SK Putrajaya Presint 8(1), to show group slots.
with numbered as (
  select id, (row_number() over (order by name) - 1)::int as i from public.schools
)
insert into public.slots (officer_id, school_id, starts_at, ends_at, capacity, appointment_type_id)
select '00000000-0000-0000-0000-00000000aaaa', n.id,
       (d::date + time '08:00' + (n.i / 5) * interval '1 hour' + q * interval '15 minutes') at time zone 'Asia/Kuala_Lumpur',
       (d::date + time '08:15' + (n.i / 5) * interval '1 hour' + q * interval '15 minutes') at time zone 'Asia/Kuala_Lumpur',
       1, null
from numbered n
cross join generate_series(current_date + 1, current_date + 21, interval '1 day') as d  -- d::date: keep it a local date
cross join generate_series(0, 3) as q
where extract(isodow from d) = (n.i % 5) + 1
on conflict do nothing;

insert into public.slots (officer_id, school_id, starts_at, ends_at, capacity, appointment_type_id)
select '00000000-0000-0000-0000-00000000aaaa', sc.id,
       (d::date + t) at time zone 'Asia/Kuala_Lumpur',
       (d::date + t + interval '30 minutes') at time zone 'Asia/Kuala_Lumpur',
       10, (select id from public.appointment_types where code = 'vaccination')
from generate_series(current_date + 1, current_date + 21, interval '1 day') as d  -- d::date: keep it a local date
cross join (values (time '14:00'), (time '14:30')) as v(t)
join public.schools sc on sc.slug = 'sk-putrajaya-presint-8-1' and extract(isodow from d) = 5
on conflict do nothing;
