#!/bin/bash
# Step 1: bring jeffi_stores' schema to this commit. The additive migra diff of database/*.sql is shown,
# then applied exactly as shown in one transaction, then manual.sql (foreign keys + the column change the
# diff never applies), then a re-check of what is left.
# Usage: bash deploy/k8s/db/10-platform-schema.sh [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
mkdir -p "$OUT_DIR"
PLAN=$OUT_DIR/schema-platform-jeffi_stores.sql
tunnel

say "Schema diff for jeffi_stores (nothing applied yet)"
schema_diff jeffi_stores --set=platform --dry-run
if $DRY_RUN; then echo "Dry run: nothing written. Would apply $PLAN, then deploy/k8s/db/manual.sql."; exit 0; fi
confirm "Apply the diff above (one transaction), then manual.sql?"

say "Apply the diff"
cp "$PLAN" "$OUT_DIR/applied-schema-platform.sql"
if [ -s "$PLAN" ]; then psql_app jeffi_stores -1 -q -f "$PLAN"; else echo "(empty)"; fi
say "manual.sql"
psql_app jeffi_stores -q -f "$REPO/deploy/k8s/db/manual.sql"
say "Re-check"
schema_diff jeffi_stores --set=platform --dry-run > "$OUT_DIR/schema-recheck.log" 2>&1
# migra re-emits every CHECK (DROP IF EXISTS + ADD ... NOT VALID) on each run; anything else is a real leftover.
LEFT=$(grep -viE 'drop constraint if exists|add constraint .* check .* not valid;' "$PLAN" | grep -c ';' || true)
echo "$LEFT statement(s) left besides the CHECK re-adds (expect 0): $PLAN"
