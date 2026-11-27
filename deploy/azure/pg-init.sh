#!/bin/bash
# One-time: prepare the self-hosted Azure flagship database (the flagship-postgres pod on the core, after apply.sh,
# pg-disk.sh and deploy/k8s/overlays/azure/postgres.yaml). From a machine that reaches the k8s API:
#   1. the k8s Secret flagship-postgres in jeffi (username jeffiadmin, password pg-admin-password, database jeffi_stores),
#      which the pod reads once, at initdb: it must exist before the pod's first start;
#   2. wait for flagship-postgres-0 to be Ready;
#   3. through a kubectl port-forward, as the superuser: the app_user login, its password generated straight into Key
#      Vault (pg-app-password, never printed), ownership of jeffi_stores, and the four extensions.
# Then restore the flagship dump as app_user (README, Phase D) and run release-db.sh --cloud=azure. Idempotent; dry
# run without --apply.
# Usage: JEFFI_CLOUD=azure bash deploy/azure/pg-init.sh [--apply]
export JEFFI_CLOUD=azure
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
source "$(dirname "$0")/../k8s/db/lib.sh"
NS=$AZ_PG_NAMESPACE POD=flagship-postgres-0

say "k8s Secret flagship-postgres in $NS"
sec=no; kubectl -n "$NS" get secret flagship-postgres >/dev/null 2>&1 && sec=yes
echo "exists: $sec; would be created/updated from pg-admin-password in $AZ_KEY_VAULT (user $AZ_PG_ADMIN, database jeffi_stores)"
if $APPLY; then
  umask 077
  sd=$(mktemp -d); on_exit "rm -rf '$sd'"
  printf '%s' "$AZ_PG_ADMIN" > "$sd/username"
  printf '%s' jeffi_stores > "$sd/database"
  kv_secret pg-admin-password | tr -d '\n' > "$sd/password"
  [ -s "$sd/password" ] || { echo "pg-admin-password is not readable in $AZ_KEY_VAULT" >&2; exit 1; }
  kubectl -n "$NS" create secret generic flagship-postgres --from-file=username="$sd/username" \
    --from-file=password="$sd/password" --from-file=database="$sd/database" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "flagship-postgres applied (initdb reads it once: changing it later does not change the superuser's password)"
fi

say "Pod $POD"
if ! kubectl -n "$NS" get pod "$POD" >/dev/null 2>&1; then
  echo "$POD does not exist: the StatefulSet isn't applied yet. The release applies it, or: kubectl apply -f deploy/k8s/overlays/azure/postgres.yaml" >&2
  $APPLY && exit 1
  echo "Dry run: nothing changed (--apply)."; exit 0
fi
if ! $APPLY; then
  echo "ready: $(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')"
else
  kubectl -n "$NS" wait --for=condition=Ready "pod/$POD" --timeout=300s ||
    { echo "$POD is not Ready after 5 minutes: kubectl -n $NS describe pod $POD; kubectl -n $NS logs $POD" >&2; exit 1; }
fi

tunnel
say "Azure Postgres $AZ_PG_SERVICE (127.0.0.1:$AZ_PG_PORT) as $AZ_PG_ADMIN"
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
# Every service secret in the vault now logs in as app_user here instead of RDS IAM (values never printed).
AZ_KEY_VAULT=$AZ_KEY_VAULT AZ_PG_HOST=$AZ_PG_HOST bash "$(dirname "$0")/kv-sync.sh" --azure-db --apply
say "Done. Next: restore the flagship dump as app_user, then: bash deploy/k8s/db/release-db.sh --cloud=azure --dry-run"
