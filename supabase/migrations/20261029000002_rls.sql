-- Vaksin App: Row Level Security.
-- Rules of thumb:
--   * Parents see only children linked to them and schools they joined.
--   * Officers see only schools in officer_schools, and only with 2FA (aal2).
--   * Platform admin (iMotion) manages schools/officers but does NOT read
--     student health data.
--   * Inserts that need cross-checks (joining a school, registering a child)
--     have no policy at all: they go through security-definer functions.

-- Helpers -----------------------------------------------------------------

create function public.has_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_aal2() and exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'platform_admin')
$$;

create function public.is_officer_for(p_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_aal2() and exists (
    select 1 from public.officer_schools os
    join public.profiles p on p.user_id = os.officer_id
    where os.officer_id = auth.uid() and os.school_id = p_school and p.role = 'officer')
$$;

create function public.is_parent_at(p_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.parent_schools
    where parent_id = auth.uid() and school_id = p_school)
$$;

create function public.is_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.student_guardians
    where guardian_id = auth.uid() and student_id = p_student)
$$;

create function public.student_school(p_student uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.students where id = p_student
$$;

create function public.slot_school(p_slot uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.slots where id = p_slot
$$;

-- Columns users must never change directly through the API ----------------

create function public.guard_protected_columns() returns trigger
language plpgsql as $$
begin
  -- Nested IFs on purpose: plpgsql does not short-circuit AND, so reading
  -- new.school_id on a profiles row would fail even behind a table-name check.
  if current_user in ('authenticated', 'anon') then
    if tg_table_name = 'profiles' then
      if new.role is distinct from old.role then
        raise exception 'role can only be changed by a platform admin';
      end if;
    elsif tg_table_name = 'students' then
      if new.school_id is distinct from old.school_id
         or new.mykid_last4 is distinct from old.mykid_last4 then
        raise exception 'school and MyKid cannot be changed here';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_protected_columns();
create trigger students_guard before update on public.students
  for each row execute function public.guard_protected_columns();

-- Enable RLS everywhere ---------------------------------------------------

alter table public.schools             enable row level security;
alter table public.profiles            enable row level security;
alter table public.officer_schools     enable row level security;
alter table public.parent_schools      enable row level security;
alter table public.students            enable row level security;
alter table public.student_identifiers enable row level security; -- no policies on purpose
alter table public.student_guardians   enable row level security;
alter table public.guardian_requests   enable row level security;
alter table public.appointment_types   enable row level security;
alter table public.booking_settings    enable row level security;
alter table public.availability_rules  enable row level security;
alter table public.closures            enable row level security;
alter table public.slots               enable row level security;
alter table public.appointments        enable row level security;
alter table public.visit_notes         enable row level security;
alter table public.audit_log           enable row level security;

-- Schools
create policy schools_read on public.schools for select to authenticated
  using (public.is_platform_admin() or public.is_officer_for(id) or public.is_parent_at(id));
create policy schools_admin_write on public.schools for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Profiles
create policy profiles_self_read on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated
  using (public.is_platform_admin());
create policy profiles_officer_reads_guardians on public.profiles for select to authenticated
  using (exists (
    select 1 from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    where sg.guardian_id = profiles.user_id and public.is_officer_for(s.school_id)));
create policy profiles_self_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Officer / parent school links
create policy officer_schools_read on public.officer_schools for select to authenticated
  using (officer_id = auth.uid() or public.is_platform_admin());
create policy officer_schools_admin_write on public.officer_schools for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy parent_schools_read on public.parent_schools for select to authenticated
  using (parent_id = auth.uid() or public.is_officer_for(school_id));

-- Students
create policy students_read on public.students for select to authenticated
  using (public.is_guardian_of(id) or public.is_officer_for(school_id));
create policy students_guardian_update on public.students for update to authenticated
  using (public.is_guardian_of(id)) with check (public.is_guardian_of(id));
create policy students_officer_update on public.students for update to authenticated
  using (public.is_officer_for(school_id)) with check (public.is_officer_for(school_id));

create policy guardians_read on public.student_guardians for select to authenticated
  using (guardian_id = auth.uid()
         or public.is_guardian_of(student_id)
         or public.is_officer_for(public.student_school(student_id)));

create policy guardian_requests_read on public.guardian_requests for select to authenticated
  using (requester_id = auth.uid()
         or public.is_guardian_of(student_id)
         or public.is_officer_for(public.student_school(student_id)));

-- Appointment types are public reference data
create policy types_read on public.appointment_types for select to anon, authenticated
  using (active or public.is_platform_admin());
create policy types_admin_write on public.appointment_types for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Booking settings
create policy settings_read on public.booking_settings for select to authenticated
  using (public.is_parent_at(school_id) or public.is_officer_for(school_id) or public.is_platform_admin());
create policy settings_officer_write on public.booking_settings for update to authenticated
  using (public.is_officer_for(school_id) or public.is_platform_admin())
  with check (public.is_officer_for(school_id) or public.is_platform_admin());

-- Availability (officer's own rules at their schools)
create policy rules_officer_all on public.availability_rules for all to authenticated
  using (officer_id = auth.uid() and public.is_officer_for(school_id))
  with check (officer_id = auth.uid() and public.is_officer_for(school_id));

create policy closures_officer_all on public.closures for all to authenticated
  using (public.is_officer_for(school_id)) with check (public.is_officer_for(school_id));

-- Slots: parents see open slots at schools they joined
create policy slots_parent_read on public.slots for select to authenticated
  using (status = 'open' and public.is_parent_at(school_id));
create policy slots_officer_all on public.slots for all to authenticated
  using (public.is_officer_for(school_id))
  with check (officer_id = auth.uid() and public.is_officer_for(school_id));

-- Appointments: parents read their children's; booking itself goes through book_slot() (Phase 3)
create policy appointments_parent_read on public.appointments for select to authenticated
  using (booked_by = auth.uid() or public.is_guardian_of(student_id));
create policy appointments_officer_read on public.appointments for select to authenticated
  using (public.is_officer_for(public.slot_school(slot_id)));
create policy appointments_officer_update on public.appointments for update to authenticated
  using (public.is_officer_for(public.slot_school(slot_id)))
  with check (public.is_officer_for(public.slot_school(slot_id)));

create policy visit_notes_officer_all on public.visit_notes for all to authenticated
  using (exists (select 1 from public.appointments a
                 where a.id = appointment_id and public.is_officer_for(public.slot_school(a.slot_id))))
  with check (officer_id = auth.uid() and exists (
                 select 1 from public.appointments a
                 where a.id = appointment_id and public.is_officer_for(public.slot_school(a.slot_id))));

-- Audit log: read-only for officers (own schools) and admin; written by functions only
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_platform_admin() or (school_id is not null and public.is_officer_for(school_id)));
