#!/bin/bash
# Apply this release's schema to every store tenant's own database, from inside the controller pod: the
# desired-state fan-out, then pending database/migrations files. A tenant already at <sha> is skipped, so
# re-running is safe. rollout.sh runs it once the platform is up, before re-applying the stores.
# Usage: bash deploy/k8s/db/40-tenant-fanout.sh <sha> [--dry-run]
source "$(dirname "$0")/lib.sh"
SHA=${1:?short git sha of the release}
k8s_tunnel
if $DRY_RUN; then
  kubectl -n jeffi exec deploy/$CTRL -- printenv NEXT_PUBLIC_GIT_SHA | sed 's/^/controller image at /'
  echo "Dry run: would POST /api/internal/migrations/fanout and /files-fanout with gitSha $SHA."; exit 0
fi
say "Tenant schema fan-out ($SHA)"
in_cluster tenant_schema_fanout /api/internal/migrations/fanout "{\"gitSha\":\"$SHA\"}"
say "Tenant migration files"
in_cluster tenant_migration_files /api/internal/migrations/files-fanout "{\"gitSha\":\"$SHA\"}"
