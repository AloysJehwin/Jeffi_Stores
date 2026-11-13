#!/bin/bash
# The release's database changes, before any service rolls: ci.yml's DB stage runs it (one job per target, side
# by side), or run it by hand. Targets:
#   --flagship   jeffi_stores, the platform set: --schema is 10-platform-schema.sh (table ownership, the additive
#                diff of every <service>/database/ and platform-only/, manual.sql), then the control-plane diff
#                and its plan seed; --migrations is every pending migrations/*.sql (schema_migrations).
#   --tenants    every store tenant's own database, the tenant set (40-tenant-fanout.sh): the desired-state
#                fan-out and the tenant migrations, run in a one-off Job from the release's controller image
#                (local-<image sha of HEAD>; CI's Images stage or release.sh --build-only pushes it first).
# Neither target: both, the flagship first. Neither --schema nor --migrations: both, schema first.
# --dry-run shows the SQL (flagship) or validates the Job (tenants) and applies nothing; --yes skips the prompts (CI).
# Usage: bash deploy/k8s/db/release-db.sh [--flagship] [--tenants] [--schema] [--migrations] [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
FLAGSHIP=false; TENANTS=false; SCHEMA=false; MIGRATIONS=false
for a in "$@"; do case $a in
  --flagship) FLAGSHIP=true ;; --tenants) TENANTS=true ;; --schema) SCHEMA=true ;; --migrations) MIGRATIONS=true ;;
esac; done
$FLAGSHIP || $TENANTS || { FLAGSHIP=true; TENANTS=true; }
$SCHEMA || $MIGRATIONS || { SCHEMA=true; MIGRATIONS=true; }
mkdir -p "$OUT_DIR"
pass=(); $DRY_RUN && pass+=(--dry-run); $YES && pass+=(--yes)

if $FLAGSHIP; then
  tunnel
  if $SCHEMA; then
    bash "$REPO/deploy/k8s/db/10-platform-schema.sh" ${pass[@]+"${pass[@]}"}
    say "Control-plane schema diff for jeffi_stores"
    schema_diff jeffi_stores --set=control-plane --dry-run
    if ! $DRY_RUN; then
      confirm "Apply the control-plane diff above and re-seed the plans?"
      schema_diff jeffi_stores --set=control-plane
    fi
  fi
  if $MIGRATIONS; then
    say "File migrations on jeffi_stores (every <service>/database/migrations and platform-only/migrations)"
    flag=(); $DRY_RUN && flag=(--dry-run)
    RDS_HOST=$RDS_HOST RDS_PORT=5432 RDS_CONNECT_HOST=127.0.0.1 RDS_CONNECT_PORT=$PORT RDS_USER=app_user RDS_DB=jeffi_stores \
      bash "$REPO/deploy/run-migrations.sh" ${flag[@]+"${flag[@]}"}
  fi
fi

if $TENANTS; then
  half=(); $SCHEMA && ! $MIGRATIONS && half=(--schema); $MIGRATIONS && ! $SCHEMA && half=(--migrations)
  $DRY_RUN || confirm "Apply the tenant schema set and tenant migrations to every store's database?"
  bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "$(image_sha)" ${half[@]+"${half[@]}"} ${pass[@]+"${pass[@]}"}
fi
say "Done. SQL and logs: $OUT_DIR"
