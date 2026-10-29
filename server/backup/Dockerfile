# Vaksin App nightly backup: pg_dump, encrypted with age, kept 7 days on this PC and
# copied to Cloudflare R2 (30 daily + 12 monthly). Runs at 02:00 Malaysia time.
FROM alpine:3.22.2
RUN apk add --no-cache postgresql17-client age rclone tzdata
COPY backup.sh restore-test.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-test.sh \
 && echo '0 2 * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
