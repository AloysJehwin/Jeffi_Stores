#!/bin/bash
# The release's changes to jeffi_stores, run by ci.yml's deploy job before the rollout (or by hand):
#   --schema      10-platform-schema.sh (table ownership, the additive database/*.sql diff, manual.sql), then the
#                 control-plane diff (database/control-plane/schema.sql) and its plan seed.
#   --migrations  pending database/migrations files (tracked in schema_migrations).
# Neither flag: both. Store tenants' databases follow in rollout.sh (40-tenant-fanout.sh) once the new
# controller is up. --dry-run shows the SQL and applies nothing; --yes skips the prompts (CI).
# Usage: bash deploy/k8s/db/release-db.sh [--schema] [--migrations] [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
SCHEMA=false; MIGRATIONS=false
for a in "$@"; do case $a in --schema) SCHEMA=true ;; --migrations) MIGRATIONS=true ;; esac; done
$SCHEMA || $MIGRATIONS || { SCHEMA=true; MIGRATIONS=true; }
mkdir -p "$OUT_DIR"
tunnel

if $SCHEMA; then
  bash "$REPO/deploy/k8s/db/10-platform-schema.sh" "$@"
  say "Control-plane schema diff for jeffi_stores"
  schema_diff jeffi_stores --set=control-plane --dry-run
  if ! $DRY_RUN; then
    confirm "Apply the control-plane diff above and re-seed the plans?"
    schema_diff jeffi_stores --set=control-plane
  fi
fi

if $MIGRATIONS; then
  say "File migrations (database/migrations)"
  flag=(); $DRY_RUN && flag=(--dry-run)
  RDS_HOST=$RDS_HOST RDS_PORT=5432 RDS_CONNECT_HOST=127.0.0.1 RDS_CONNECT_PORT=$PORT RDS_USER=app_user RDS_DB=jeffi_stores \
    bash "$REPO/deploy/run-migrations.sh" ${flag[@]+"${flag[@]}"}
fi
say "Done. SQL and logs: $OUT_DIR"
