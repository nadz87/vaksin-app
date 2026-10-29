# Vaksin App database: official Postgres 17 plus pgTAP and pg_prove for the test suite.
# The same image runs in production; pgTAP is only created inside test databases.
FROM postgres:17.11-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgtap libtap-parser-sourcehandler-pgtap-perl \
 && rm -rf /var/lib/apt/lists/*
