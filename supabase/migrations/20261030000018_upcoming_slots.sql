-- Vaksin App: the officer's own upcoming open slots, for the per-type list in Tetapan.
-- No date range (officer_slots caps at 62 days); slots without a type are left to the calendar.
create function public.officer_upcoming_slots()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity smallint,
               appointment_type_id uuid, location_name text, booked integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception 'not_allowed';
  end if;

  return query
  select s.id, s.starts_at, s.ends_at, s.capacity, s.appointment_type_id, l.name,
         (count(a.id) filter (where a.status = 'booked'))::int
  from public.slots s
  join public.locations l on l.id = s.location_id
  left join public.appointments a on a.slot_id = s.id
  where s.officer_id = auth.uid()
    and s.status = 'open'
    and s.appointment_type_id is not null
    and s.starts_at > now()
  group by s.id, l.name
  order by s.starts_at
  limit 2000;
end $$;

revoke execute on function public.officer_upcoming_slots() from public, anon;
grant execute on function public.officer_upcoming_slots() to authenticated;
