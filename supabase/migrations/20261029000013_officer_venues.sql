-- Vaksin App: where is the officer on each day? (the "venue" shown on the home tile
-- and the calendar). Read from the officer's own open slots across all their schools,
-- so one officer visiting several schools sees the right school for each day.
-- Reminder: no CASE ... END and no dollar-sign regex anchors inside function bodies.

create function public.officer_venues(p_from date, p_to date)
returns table (day date, school_id uuid, school_name text, state text,
               first_start timestamptz, last_end timestamptz, slots int, booked int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_aal2() and exists (
      select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'officer')) then
    raise exception 'not_allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'bad_range';
  end if;

  return query
  select (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date,
         s.school_id, sc.name, sc.state,
         min(s.starts_at), max(s.ends_at),
         (count(distinct s.id))::int,
         (count(a.id))::int
  from public.slots s
  join public.schools sc on sc.id = s.school_id
  left join public.appointments a on a.slot_id = s.id and a.status in ('booked', 'completed', 'no_show')
  where s.officer_id = auth.uid()
    and s.status = 'open'
    and (s.starts_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by 1, 2, 3, 4
  order by 1, min(s.starts_at);
end $$;

revoke execute on function public.officer_venues(date, date) from public;
grant execute on function public.officer_venues(date, date) to authenticated;
