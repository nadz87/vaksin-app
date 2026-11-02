-- Vaksin App: an officer can run different appointment types side by side at one clinic.
-- Slots of the same type still cannot overlap, and the officer still cannot be at two
-- locations at once. Both rules are stricter than nothing and looser than the old one,
-- so existing slots already satisfy them.
alter table public.slots drop constraint slots_no_overlap;
alter table public.slots drop constraint slots_officer_id_starts_at_key;

alter table public.slots
  add constraint slots_no_overlap_same_type
  exclude using gist (officer_id with =,
                      (coalesce(appointment_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
                      tstzrange(starts_at, ends_at) with &&);

alter table public.slots
  add constraint slots_no_overlap_other_location
  exclude using gist (officer_id with =, location_id with <>, tstzrange(starts_at, ends_at) with &&);
