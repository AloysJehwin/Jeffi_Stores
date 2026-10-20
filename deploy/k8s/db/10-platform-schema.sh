#!/bin/bash
# Step 1: bring jeffi_stores' schema to this commit. First 05-table-owner.sh (so app_user can alter the older
# tables), then the additive migra diff of database/*.sql, shown and applied exactly as shown in one transaction,
# then manual.sql (foreign keys + the column change the diff never applies), then a re-check of what is left.
# Usage: bash deploy/k8s/db/10-platform-schema.sh [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
mkdir -p "$OUT_DIR"
PLAN=$OUT_DIR/schema-platform-jeffi_stores.sql
tunnel
bash "$REPO/deploy/k8s/db/05-table-owner.sh" "$@"

say "Schema diff for jeffi_stores (nothing applied yet)"
schema_diff jeffi_stores --set=platform --dry-run
if $DRY_RUN; then echo "Dry run: nothing written. Would apply $PLAN, then deploy/k8s/db/manual.sql."; exit 0; fi
confirm "Apply the diff above (one transaction), then manual.sql?"

say "Apply the diff"
cp "$PLAN" "$OUT_DIR/applied-schema-platform.sql"
# One transaction, so every ALTER's lock is held until commit: give up on a lock after 20s rather than
# sit behind live traffic (or deadlock with it), and try again — the diff is idempotent.
apply_plan() { psql_app jeffi_stores -1 -q -c "SET lock_timeout = '20s'" -f "$PLAN"; }
if [ -s "$PLAN" ]; then
  for attempt in 1 2 3; do apply_plan && break; [ $attempt = 3 ] && exit 3; echo "apply attempt $attempt failed; retrying in 15s"; sleep 15; done
else echo "(empty)"; fi
say "manual.sql"
psql_app jeffi_stores -q -f "$REPO/deploy/k8s/db/manual.sql"
say "Re-check"
schema_diff jeffi_stores --set=platform --dry-run > "$OUT_DIR/schema-recheck.log" 2>&1
# Expected leftovers: every CHECK (migra sees NOT VALID vs valid; the DO block skips the unchanged ones), and indexes/primary keys that already exist under
# the same name with an older definition (IF NOT EXISTS keeps them). Anything else did not apply.
IDX=$(grep -oiE '^create (unique )?index if not exists [a-z0-9_]+' "$PLAN" | awk '{print $NF}' | tr '\n' ' ')
PKS=$(grep -oE "t.relname = '[a-z0-9_]+' AND c.contype = 'p'" "$PLAN" | cut -d"'" -f2 | tr '\n' ' ')
psql_app jeffi_stores -At -v idx="$IDX" -v pks="$PKS" <<'SQL'
SELECT 'Kept as they are (exist with an older definition): '
  || (SELECT count(*) FROM unnest(string_to_array(trim(:'idx'), ' ')) i WHERE to_regclass('public.' || i) IS NOT NULL) || ' index(es), '
  || (SELECT count(*) FROM unnest(string_to_array(trim(:'pks'), ' ')) t
       WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.' || t) AND contype = 'p')) || ' primary key(s)';
SELECT 'Not applied: ' || i FROM unnest(string_to_array(trim(:'idx'), ' ')) i WHERE to_regclass('public.' || i) IS NULL;
SQL
grep -iE '^(create table|alter table .* add column|create sequence|create extension)' "$PLAN" | sed 's/^/Not applied: /' || true
