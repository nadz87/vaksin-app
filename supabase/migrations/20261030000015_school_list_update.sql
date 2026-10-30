-- Vaksin App: school list updated from the owner's lists (2026-10-30).
-- Sekolah Rendah (SKPP): 16 schools, adds Presint 8(3) and 15(1).
-- Sekolah Menengah (SMKPP): 11 schools, adds SMK Presint 15(1).
-- Sekolah Sultan Alam Shah is not on the list: hidden from the picker (active = false)
-- rather than deleted, so any record that points at it keeps working.

insert into public.schools (name, slug, level, state, weekend_days) values
  ('SK Putrajaya Presint 8(3)',   'sk-putrajaya-presint-8-3',   'rendah',   'W.P. Putrajaya', '{6,7}'),
  ('SK Putrajaya Presint 15(1)',  'sk-putrajaya-presint-15-1',  'rendah',   'W.P. Putrajaya', '{6,7}'),
  ('SMK Putrajaya Presint 15(1)', 'smk-putrajaya-presint-15-1', 'menengah', 'W.P. Putrajaya', '{6,7}')
on conflict (slug) do update set active = true;

update public.schools set active = false where slug = 'sekolah-sultan-alam-shah';
