#!/bin/sh
# Proves the newest backup can be read and restored, without touching the live database.
# The private key arrives on stdin and only ever sits in memory (/dev/shm), never on disk:
#   node server/prod.mjs restore-test <path-to-private-key-file>
set -eu
set -o pipefail

latest=$(ls -1t /backups/vaksin_*.dump.age 2>/dev/null | head -n 1)
if [ -z "$latest" ]; then
  echo "restore-test: no backup found in /backups" >&2
  exit 1
fi
echo "restore-test: using $(basename "$latest")"

umask 077
keyfile=/dev/shm/restore-key
trap 'rm -f "$keyfile"' EXIT
cat > "$keyfile"

psql -h db -U postgres -d postgres -qc "drop database if exists vaksin_restore_test with (force)"
psql -h db -U postgres -d postgres -qc "create database vaksin_restore_test"
age -d -i "$keyfile" "$latest" | pg_restore -h db -U postgres -d vaksin_restore_test --no-owner --exit-on-error

psql -h db -U postgres -d vaksin_restore_test -Atc "
  select 'schools ' || count(*) from public.schools
  union all select 'students ' || count(*) from public.students
  union all select 'appointments ' || count(*) from public.appointments
  union all select 'accounts ' || count(*) from auth.users
  union all select 'migrations ' || count(*) from migrations.applied"
psql -h db -U postgres -d postgres -qc "drop database vaksin_restore_test with (force)"
echo "restore-test: OK, the backup restores"
