-- Parent contact details, asked once after the first sign-in ("Lengkapkan profil").
-- Phone is stored normalised as +601XXXXXXXX(X) (Malaysian mobile).

alter table public.profiles
  add constraint profiles_phone_format check (phone is null or phone ~ '^\+601[0-9]{8,9}$'),
  add constraint profiles_full_name_length check (full_name is null or char_length(trim(full_name)) between 2 and 120);
