#!/bin/bash
# One-time: prepare the Azure flagship database (after apply.sh's first pass, from a machine on the tailnet once the
# core advertises the Postgres subnet). As the admin (pg-admin-password): the app_user login, its password generated
# straight into Key Vault (pg-app-password, never printed), azure_pg_admin membership (CREATE EXTENSION for the
# allow-listed four), ownership of jeffi_stores, and the extensions. Then restore the flagship dump as app_user
# (README, Phase D) and run release-db.sh --cloud=azure. Idempotent; dry run without --apply.
# Usage: JEFFI_CLOUD=azure bash deploy/azure/pg-init.sh [--apply]
export JEFFI_CLOUD=azure
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
source "$(dirname "$0")/../k8s/db/lib.sh"
tunnel
say "Azure Postgres $AZ_PG_HOST ($PG_ADDR) as $AZ_PG_ADMIN"
psql_master postgres -Atc "select version()"
have=$(psql_master postgres -Atc "select count(*) from pg_roles where rolname = 'app_user'")
pw_set=$(az keyvault secret show --vault-name "$AZ_KEY_VAULT" --name pg-app-password --query id -o tsv 2>/dev/null || true)
echo "app_user exists: $([ "$have" = 1 ] && echo yes || echo no); pg-app-password in $AZ_KEY_VAULT: $([ -n "$pw_set" ] && echo yes || echo no)"
if ! $APPLY; then echo "Dry run: nothing changed (--apply)."; exit 0; fi

umask 077
d=$(mktemp -d); on_exit "rm -rf '$d'"
if [ -z "$pw_set" ]; then
  openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-32 > "$d/pw"
  az keyvault secret set --vault-name "$AZ_KEY_VAULT" --name pg-app-password --file "$d/pw" --encoding utf-8 --output none
  echo "pg-app-password generated into $AZ_KEY_VAULT"
else
  az keyvault secret show --vault-name "$AZ_KEY_VAULT" --name pg-app-password --query value -o tsv > "$d/pw"
fi
# The password reaches psql as a variable over stdin, so it is in neither argv nor the log.
{
  printf '\\set pw `cat %s`\n' "$d/pw"
  cat <<'SQL'
SELECT format('CREATE ROLE app_user LOGIN PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') \gexec
SELECT format('ALTER ROLE app_user PASSWORD %L', :'pw') \gexec
GRANT azure_pg_admin TO app_user;
ALTER DATABASE jeffi_stores OWNER TO app_user;
SQL
} | psql_master postgres -q
psql_master jeffi_stores -q <<'SQL'
GRANT ALL ON SCHEMA public TO app_user;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
unset PGPASSFILE; az_pgpass # re-read, now with app_user's password
psql_app jeffi_stores -Atc "select current_user, (select string_agg(extname, ',' order by extname) from pg_extension)"
say "Done. Next: restore the flagship dump as app_user, then: bash deploy/k8s/db/release-db.sh --cloud=azure --dry-run"
