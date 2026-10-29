-- Vaksin App: core schema (Phase 1).
-- Every school-owned row carries school_id. Access is enforced by RLS
-- (see 20261029000002_rls.sql); writes that need cross-table checks go
-- through security-definer functions (20261029000003_functions.sql).

create type public.user_role as enum ('parent', 'officer', 'platform_admin');
create type public.slot_status as enum ('open', 'blocked');
create type public.appointment_status as enum ('booked', 'cancelled', 'completed', 'no_show');
create type public.request_status as enum ('pending', 'approved', 'rejected');

-- Schools -----------------------------------------------------------------

create table public.schools (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  logo_url     text,
  state        text,
  -- ISO weekday numbers (1 = Mon ... 7 = Sun). Kedah/Kelantan/Terengganu use {5,6}.
  weekend_days smallint[] not null default '{6,7}',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- People ------------------------------------------------------------------

create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null default 'parent',
  full_name  text,
  phone      text,
  email      text,
  language   text not null default 'ms' check (language in ('ms', 'en')),
  created_at timestamptz not null default now()
);

-- One officer can serve many schools; also allows more officers later.
create table public.officer_schools (
  officer_id uuid not null references public.profiles (user_id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  primary key (officer_id, school_id)
);

-- A parent picks their child's school by name before adding children there
-- (no school code, owner decision 2026-10-29).
create table public.parent_schools (
  parent_id  uuid not null references public.profiles (user_id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (parent_id, school_id)
);

-- Students ----------------------------------------------------------------

create table public.students (
  id                      uuid primary key default gen_random_uuid(),
  school_id               uuid not null references public.schools (id),
  full_name               text not null,
  date_of_birth           date not null,
  gender                  text not null check (gender in ('male', 'female')),
  class_name              text not null,
  mykid_last4             text not null check (mykid_last4 ~ '^[0-9]{4}$'),
  blood_group             text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  height_cm               numeric(5,1) check (height_cm between 30 and 250),
  weight_kg               numeric(5,1) check (weight_kg between 2 and 250),
  allergies               text,
  conditions              text,
  medications             text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  photo_url               text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on public.students (school_id);

-- Full MyKid number lives apart from the student row: no RLS select policy,
-- read only through reveal_mykid() which writes an audit entry.
create table public.student_identifiers (
  student_id uuid primary key references public.students (id) on delete cascade,
  mykid_no   text not null unique check (mykid_no ~ '^[0-9]{12}$')
);

create table public.student_guardians (
  student_id   uuid not null references public.students (id) on delete cascade,
  guardian_id  uuid not null references public.profiles (user_id) on delete cascade,
  relationship text not null default 'guardian' check (relationship in ('mother', 'father', 'guardian')),
  consent_at   timestamptz not null default now(),
  primary key (student_id, guardian_id)
);

-- Second parent asking to be linked to a child that already exists.
create table public.guardian_requests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id) on delete cascade,
  requester_id uuid not null references public.profiles (user_id) on delete cascade,
  relationship text not null default 'guardian' check (relationship in ('mother', 'father', 'guardian')),
  status       public.request_status not null default 'pending',
  decided_by   uuid references public.profiles (user_id),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  unique (student_id, requester_id)
);

-- Appointments setup ------------------------------------------------------

create table public.appointment_types (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name_ms          text not null,
  name_en          text not null,
  icon             text not null,
  color            text not null,
  duration_min     smallint not null default 15 check (duration_min between 5 and 240),
  default_capacity smallint not null default 1 check (default_capacity between 1 and 100),
  needs_reason     boolean not null default false,
  sort_order       smallint not null default 0,
  active           boolean not null default true
);

create table public.booking_settings (
  school_id                       uuid primary key references public.schools (id) on delete cascade,
  min_lead_hours                  smallint not null default 2,
  cancel_cutoff_hours             smallint not null default 24,
  max_active_bookings_per_student smallint not null default 2,
  booking_window_days             smallint not null default 56
);

create table public.availability_rules (
  id                  uuid primary key default gen_random_uuid(),
  officer_id          uuid not null references public.profiles (user_id) on delete cascade,
  school_id           uuid not null references public.schools (id) on delete cascade,
  weekday             smallint not null check (weekday between 1 and 7),
  start_time          time not null,
  end_time            time not null,
  slot_minutes        smallint not null default 15 check (slot_minutes between 5 and 240),
  appointment_type_ids uuid[] not null default '{}',
  capacity            smallint not null default 1 check (capacity between 1 and 100),
  valid_from          date not null default current_date,
  valid_to            date,
  check (end_time > start_time)
);

create table public.closures (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  officer_id uuid references public.profiles (user_id) on delete cascade, -- null = whole school
  date       date not null,
  reason     text
);

create table public.slots (
  id                  uuid primary key default gen_random_uuid(),
  officer_id          uuid not null references public.profiles (user_id),
  school_id           uuid not null references public.schools (id),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  capacity            smallint not null default 1 check (capacity between 1 and 100),
  appointment_type_id uuid references public.appointment_types (id), -- null = any type
  status              public.slot_status not null default 'open',
  check (ends_at > starts_at),
  -- One officer can never be scheduled twice at the same moment, at any school.
  unique (officer_id, starts_at)
);
create index on public.slots (school_id, starts_at);

create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  slot_id       uuid not null references public.slots (id),
  student_id    uuid not null references public.students (id) on delete cascade,
  type_id       uuid not null references public.appointment_types (id),
  booked_by     uuid not null references public.profiles (user_id),
  reason_note   text,
  status        public.appointment_status not null default 'booked',
  cancelled_by  uuid references public.profiles (user_id),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.appointments (slot_id) where status = 'booked';
create index on public.appointments (student_id);

create table public.visit_notes (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null references public.appointments (id) on delete cascade,
  officer_id       uuid not null references public.profiles (user_id),
  notes            text,
  outcome          text,
  follow_up_needed boolean not null default false,
  created_at       timestamptz not null default now()
);

create table public.audit_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid references public.profiles (user_id),
  action    text not null,
  entity    text not null,
  entity_id uuid,
  school_id uuid references public.schools (id),
  meta      jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index on public.audit_log (school_id, at desc);

-- Housekeeping triggers ---------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a parent profile. Officers/admins are promoted later.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
