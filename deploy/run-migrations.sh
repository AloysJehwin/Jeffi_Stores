#!/bin/bash
# Migration runner — applies unapplied files from database/migrations/ in filename order.
# Tracks applied migrations in a schema_migrations table on RDS.
#
# Usage:
#   bash deploy/run-migrations.sh             # apply pending migrations
#   bash deploy/run-migrations.sh --dry-run   # show pending migrations without applying
#
# Requirements (set in environment):
#   RDS_HOST, RDS_PORT, RDS_USER, RDS_DB, AWS_REGION (for IAM auth)
#   or DATABASE_URL (for direct connection)

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../database/migrations" && pwd)"
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

# ── Build psql connection args ────────────────────────────────────────────────

if [[ -n "${RDS_HOST:-}" ]]; then
  PGPASSWORD=$(aws rds generate-db-auth-token \
    --hostname "$RDS_HOST" \
    --port "${RDS_PORT:-5432}" \
    --region "${AWS_REGION:-us-east-1}" \
    --username "$RDS_USER")
  export PGPASSWORD
  PSQL_ARGS="-h $RDS_HOST -p ${RDS_PORT:-5432} -U $RDS_USER -d $RDS_DB"
  SSL_ENV="PGSSLMODE=require"
else
  PSQL_ARGS="-d ${DATABASE_URL}"
  SSL_ENV=""
fi

psql_cmd() {
  env $SSL_ENV psql $PSQL_ARGS -v ON_ERROR_STOP=1 "$@"
}

# ── Ensure tracking table exists ─────────────────────────────────────────────

psql_cmd -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
" > /dev/null

# ── Collect pending migrations ────────────────────────────────────────────────

APPLIED=$(psql_cmd -t -A -c "SELECT filename FROM schema_migrations ORDER BY filename;")

PENDING=()
while IFS= read -r -d '' f; do
  name=$(basename "$f")
  if ! echo "$APPLIED" | grep -qx "$name"; then
    PENDING+=("$f")
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" -print0 | sort -z)

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "No pending migrations."
  exit 0
fi

echo "Pending migrations (${#PENDING[@]}):"
for f in "${PENDING[@]}"; do
  echo "  + $(basename "$f")"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "Dry run — nothing applied."
  exit 0
fi

# ── Apply each pending migration in order ─────────────────────────────────────

for f in "${PENDING[@]}"; do
  name=$(basename "$f")
  echo ""
  echo ">> Applying: $name"
  psql_cmd -f "$f"
  psql_cmd -c "INSERT INTO schema_migrations (filename) VALUES ('$name');" > /dev/null
  echo "   Done: $name"
done

echo ""
echo "All migrations applied."
