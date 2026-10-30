-- Vaksin App: the sign-in service sends the emails the database queues in notify.email_outbox
-- (parents told about appointments an officer cancelled; see migration 20261030000017).
-- Applied by server/migrate.mjs after auth-officers.sql: it needs the vaksin_auth role.

grant usage on schema notify to vaksin_auth;
grant select, update on notify.email_outbox to vaksin_auth;
