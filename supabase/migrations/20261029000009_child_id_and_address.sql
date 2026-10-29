-- Vaksin App: unique child ID + parent address.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside function bodies.

-- 1. Child ID: VK-<year>-<6-digit running number>, e.g. VK-26-000001 ------------
-- Assigned automatically and never editable. The running number is global
-- (not per school), so an ID is unique across the whole system and is a
-- stable key for exports and records.

create sequence public.student_no_seq;

alter table public.students add column student_no text;

-- Number existing children in registration order, then start the sequence after them.
with ordered as (
  select id, to_char(created_at at time zone 'Asia/Kuala_Lumpur', 'YY') as yy,
         row_number() over (order by created_at, id) as rn
  from public.students
)
update public.students s
set student_no = 'VK-' || o.yy || '-' || lpad(o.rn::text, 6, '0')
from ordered o
where s.id = o.id;

select setval('public.student_no_seq', (select count(*) from public.students) + 1, false);

alter table public.students
  alter column student_no set not null,
  add constraint students_student_no_key unique (student_no),
  add constraint students_student_no_format check (student_no ~ '^VK-[0-9]{2}-[0-9]{6,}$');

create function public.assign_student_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Always overwrite: the ID is never taken from the client.
  new.student_no := 'VK-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YY')
                    || '-' || lpad(nextval('public.student_no_seq')::text, 6, '0');
  return new;
end $$;

create trigger students_assign_no before insert on public.students
  for each row execute function public.assign_student_no();

-- The ID, school and MyKid can never be changed through the API.
create or replace function public.guard_protected_columns() returns trigger
language plpgsql as $$
begin
  -- Nested IFs on purpose: plpgsql does not short-circuit AND.
  if current_user in ('authenticated', 'anon') then
    if tg_table_name = 'profiles' then
      if new.role is distinct from old.role then
        raise exception 'role can only be changed by a platform admin';
      end if;
    elsif tg_table_name = 'students' then
      if new.school_id is distinct from old.school_id
         or new.mykid_last4 is distinct from old.mykid_last4
         or new.student_no is distinct from old.student_no then
        raise exception 'school, MyKid and child ID cannot be changed here';
      end if;
    end if;
  end if;
  return new;
end $$;

-- The officer's booking details now include the child ID.
create or replace function public.officer_slots(p_school uuid, p_from date, p_to date)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint,
               status public.slot_status, appointment_type_id uuid, booked int, bookings jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer_for(p_school) then
    raise exception 'not_allowed';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.appointment_type_id,
         (count(a.id) filter (where a.status = 'booked'))::int,
         coalesce(
           jsonb_agg(jsonb_build_object(
             'appointment_id', a.id,
             'student_no', st.student_no,
             'student_name', st.full_name,
             'class_name', st.class_name,
             'type_ms', t.name_ms,
             'type_en', t.name_en,
             'note', a.reason_note,
             'parent_name', pr.full_name,
             'parent_phone', pr.phone) order by a.created_at) filter (where a.status = 'booked'),
           '[]'::jsonb)
  from public.slots s
  left join public.appointments a on a.slot_id = s.id
  left join public.students st on st.id = a.student_id
  left join public.appointment_types t on t.id = a.type_id
  left join public.profiles pr on pr.user_id = a.booked_by
  where s.school_id = p_school
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by s.id
  order by s.starts_at;
end $$;

-- 2. Parent address ------------------------------------------------------------
-- Optional, but all-or-nothing: line 1, postcode, city and state go together.

alter table public.profiles
  add column address_line1 text,
  add column address_line2 text,
  add column postcode text,
  add column city text,
  add column state text,
  add constraint profiles_postcode_format check (postcode is null or postcode ~ '^[0-9]{5}$'),
  add constraint profiles_state_valid check (state is null or state in (
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis',
    'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu',
    'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya')),
  add constraint profiles_address_complete check (
    (address_line1 is null and postcode is null and city is null and state is null)
    or (address_line1 is not null and postcode is not null and city is not null and state is not null)),
  add constraint profiles_address_length check (
    char_length(coalesce(address_line1, '')) <= 150
    and char_length(coalesce(address_line2, '')) <= 150
    and char_length(coalesce(city, '')) <= 80);
