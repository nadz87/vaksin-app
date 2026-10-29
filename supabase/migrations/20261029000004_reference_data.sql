-- Vaksin App: v1 appointment types (confirmed 2026-10-29). Needed in production too.

insert into public.appointment_types (code, name_ms, name_en, icon, color, duration_min, default_capacity, needs_reason, sort_order) values
  ('screening',   'Saringan kesihatan',  'Health screening', 'stethoscope', '#2F6FED', 15, 1,  false, 1),
  ('vaccination', 'Suntikan vaksin',     'Vaccination',      'syringe',     '#7C5CF0', 10, 10, false, 2),
  ('unwell',      'Kurang sihat',        'Feeling unwell',   'thermometer', '#E2557A', 15, 1,  true,  3),
  ('follow_up',   'Temujanji susulan',   'Follow-up',        'repeat',      '#1F9D74', 15, 1,  false, 4);
