-- Vaksin App: parents edit their children's details (name, class, health, emergency contact).
-- School, MyKid, child ID, date of birth and gender stay locked: birth date and
-- gender come from the MyKid and must keep matching it.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside function bodies.

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
         or new.student_no is distinct from old.student_no
         or new.date_of_birth is distinct from old.date_of_birth
         or new.gender is distinct from old.gender then
        raise exception 'school, MyKid, birth details and child ID cannot be changed here';
      end if;
    end if;
  end if;
  return new;
end $$;

alter table public.students
  add constraint students_emergency_phone_format check (
    emergency_contact_phone is null or emergency_contact_phone ~ '^\+601[0-9]{8,9}$'),
  add constraint students_text_length check (
    char_length(trim(full_name)) between 2 and 120
    and char_length(trim(class_name)) between 1 and 40
    and char_length(coalesce(allergies, '')) <= 500
    and char_length(coalesce(conditions, '')) <= 500
    and char_length(coalesce(medications, '')) <= 500
    and char_length(coalesce(emergency_contact_name, '')) <= 120);
