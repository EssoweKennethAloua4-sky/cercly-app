#!/bin/bash
# Usage: build_db.sh dbname [with_v016] [with_demo]
set -e
DB=$1; P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
S="$(cd "$(dirname "$0")/.." && pwd)"
psql -h /tmp -p 5433 -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
# roles are cluster-wide: create once
psql -h /tmp -p 5433 -U postgres -d $DB -q -c "select 1 from pg_roles where rolname='anon'" | grep -q 1 || true
$P -d $DB -f "$(dirname "$0")/supabase_stub.sql" 2>&1 | grep -v "already exists" || true
$P -d $DB -f $S/schema.sql
for f in $(ls $S/migration-v0.*.sql | grep -v -e v0.16 -e v0.17 | sort -V); do
  sed 's/^create extension if not exists pg_cron;/-- pg_cron (faux, deja present)/' "$f" | $P -d $DB -f - || { echo "ECHEC dans $f"; exit 1; }
done
if [ "$2" = "with_v016" ]; then $P -d $DB -f $S/migration-v0.16-securite.sql; fi
if [ "$3" = "with_demo" ]; then
  $P -d $DB -f $S/migration-v0.16.1-fonctions-anon.sql
  $P -d $DB -c "insert into auth.users (email, email_confirmed_at, encrypted_password) values ('kennethaloua3+cercly-demo@gmail.com', now(), 'hash-initial')"
  $P -d $DB -f $S/migration-v0.17-demo.sql
fi
echo "OK $DB"
