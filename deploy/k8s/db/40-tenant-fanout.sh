#!/bin/bash
# Apply this release's schema to every store tenant's own database, from inside the controller pod: the
# desired-state fan-out, then pending database/migrations files. A tenant already at <sha> is skipped, so
# re-running is safe. rollout.sh runs it once the platform is up, before re-applying the stores.
# --schema or --migrations runs just that half (the pipeline runs them as separate stages); neither = both.
# Usage: bash deploy/k8s/db/40-tenant-fanout.sh <sha> [--schema|--migrations] [--dry-run]
source "$(dirname "$0")/lib.sh"
SHA=${1:?short git sha of the release}
SCHEMA=true; FILES=true
for a in "${@:2}"; do case $a in --schema) FILES=false ;; --migrations) SCHEMA=false ;; esac; done
k8s_tunnel
if $DRY_RUN; then
  kubectl -n jeffi exec deploy/$CTRL -- printenv NEXT_PUBLIC_GIT_SHA | sed 's/^/controller image at /'
  $SCHEMA && echo "Dry run: would POST /api/internal/migrations/fanout with gitSha $SHA."
  $FILES && echo "Dry run: would POST /api/internal/migrations/files-fanout with gitSha $SHA."
  exit 0
fi
if $SCHEMA; then
  say "Tenant schema fan-out ($SHA)"
  in_cluster tenant_schema_fanout /api/internal/migrations/fanout "{\"gitSha\":\"$SHA\"}"
fi
if $FILES; then
  say "Tenant migration files"
  in_cluster tenant_migration_files /api/internal/migrations/files-fanout "{\"gitSha\":\"$SHA\"}"
fi
