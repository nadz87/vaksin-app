-- Vaksin App: a child can hold 4 upcoming bookings, one for each type the clinic runs (owner, 2026-11-02).
-- booking_settings has one row per school: existing schools are raised, new ones get the new default.
alter table public.booking_settings alter column max_active_bookings_per_student set default 4;
update public.booking_settings set max_active_bookings_per_student = 4 where max_active_bookings_per_student < 4;
