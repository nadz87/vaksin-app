-- Vaksin App: school list parents pick from (owner-supplied, 2026-10-29).
-- W.P. Putrajaya, weekend Saturday-Sunday. Level groups the picker.

alter table public.schools
  add column level text not null default 'rendah' check (level in ('rendah', 'menengah'));

insert into public.schools (name, slug, level, state, weekend_days) values
  ('SK Putrajaya Presint 5(1)',   'sk-putrajaya-presint-5-1',   'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 8(1)',   'sk-putrajaya-presint-8-1',   'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 8(2)',   'sk-putrajaya-presint-8-2',   'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 9(1)',   'sk-putrajaya-presint-9-1',   'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 9(2)',   'sk-putrajaya-presint-9-2',   'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 11(1)',  'sk-putrajaya-presint-11-1',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 11(2)',  'sk-putrajaya-presint-11-2',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 11(3)',  'sk-putrajaya-presint-11-3',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 14(1)',  'sk-putrajaya-presint-14-1',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 16(1)',  'sk-putrajaya-presint-16-1',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 16(2)',  'sk-putrajaya-presint-16-2',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 17(1)',  'sk-putrajaya-presint-17-1',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 18(1)',  'sk-putrajaya-presint-18-1',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 18(2)',  'sk-putrajaya-presint-18-2',  'rendah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 5(1)',  'smk-putrajaya-presint-5-1',  'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 8(1)',  'smk-putrajaya-presint-8-1',  'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 9(1)',  'smk-putrajaya-presint-9-1',  'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 9(2)',  'smk-putrajaya-presint-9-2',  'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 11(1)', 'smk-putrajaya-presint-11-1', 'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 11(2)', 'smk-putrajaya-presint-11-2', 'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 14(1)', 'smk-putrajaya-presint-14-1', 'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 16(1)', 'smk-putrajaya-presint-16-1', 'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 18(1)', 'smk-putrajaya-presint-18-1', 'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('SMKA Putrajaya (Presint 11)', 'smka-putrajaya',             'menengah', 'W.P. Putrajaya', '{6,7}'),
  ('Sekolah Sultan Alam Shah (SBP, Presint 1)', 'sekolah-sultan-alam-shah', 'menengah', 'W.P. Putrajaya', '{6,7}')
on conflict (slug) do nothing;

-- The picker groups by level, so list_schools now returns it.
drop function public.list_schools();
create function public.list_schools()
returns table (id uuid, name text, slug text, level text, state text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.slug, s.level, s.state, s.logo_url
  from public.schools s
  where s.active
  -- rendah first, then natural order by presint number (5 before 11)
  order by s.level desc, substring(s.name from '[0-9]+')::int nulls first, s.name
$$;
revoke execute on function public.list_schools() from public;
grant execute on function public.list_schools() to anon, authenticated;
