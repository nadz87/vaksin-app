#!/bin/sh
# One backup: dump the database, encrypt it, keep it locally, copy it off this PC.
# Run by cron at 02:00, or by hand: node server/prod.mjs backup-now
set -eu
set -o pipefail

if [ -z "${AGE_RECIPIENT:-}" ]; then
  echo "backup: AGE_RECIPIENT is not set, refusing to write an unencrypted backup" >&2
  exit 1
fi

stamp=$(date +%Y-%m-%d_%H%M)
name="vaksin_${stamp}.dump.age"
file="/backups/${name}"

# Custom format (-Fc) restores table by table; age encrypts to the owner's public key.
# Only the private key, kept off this PC, can read it.
pg_dump -h db -U postgres -d vaksin -Fc | age -r "$AGE_RECIPIENT" > "${file}.part"
mv "${file}.part" "$file"
echo "backup: wrote ${name} ($(du -h "$file" | cut -f1))"

# Local copies are for quick restores only; a copy on the same PC is not a backup.
find /backups -name 'vaksin_*.dump.age' -mtime +7 -delete

if [ -z "${R2_BUCKET:-}" ]; then
  echo "backup: WARNING R2 is not set up, this backup exists only on this PC" >&2
  exit 0
fi

rclone copyto "$file" "r2:${R2_BUCKET}/daily/${name}"
rclone delete --min-age 30d "r2:${R2_BUCKET}/daily/"
if [ "$(date +%d)" = "01" ]; then
  rclone copyto "$file" "r2:${R2_BUCKET}/monthly/${name}"
  rclone delete --min-age 400d "r2:${R2_BUCKET}/monthly/"
fi
echo "backup: copied to R2 bucket ${R2_BUCKET}"
