#!/bin/bash
# Step 2, inside the write freeze: move the control plane into jeffi_stores. As app_user (the owner the app
# connects as): create the control-plane tables there without their foreign keys, copy every row from
# jeffi_control_plane in one transaction, add + validate the foreign keys, re-run seed-plans.sql and compare
# row counts. jeffi_control_plane is left untouched (the fallback).
# Usage: bash deploy/k8s/db/20-merge-control-plane.sh [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
mkdir -p "$OUT_DIR"
CP_SCHEMA="$REPO/database/control-plane/schema.sql"
TABLES=$(grep -oiE '^CREATE TABLE (IF NOT EXISTS )?public\.[a-z_0-9]+' "$CP_SCHEMA" | sed -E 's/.*public\.//' | sort -u | tr '\n' ' ')
tunnel
src() { psql_app jeffi_control_plane "$@"; }
dst() { psql_app jeffi_stores "$@"; }

counts() { # "<table> <rows>" per control-plane table; -1 = no such table
  "$1" -At -v tables="$TABLES" <<'SQL'
SELECT t || ' ' || CASE WHEN to_regclass('public.' || t) IS NULL THEN -1
  ELSE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text::bigint END
FROM unnest(string_to_array(trim(:'tables'), ' ')) t ORDER BY 1;
SQL
}

say "Rows per control-plane table: source (jeffi_control_plane) / target (jeffi_stores); -1 = no table"
SRC=$(counts src)
DST=$(counts dst)
join <(echo "$SRC") <(echo "$DST") | column -t
present=$(echo "$DST" | awk '$2 != -1 {print $1}' | tr '\n' ' ')
if [ -n "$present" ]; then
  echo "Already in jeffi_stores: $present— the merge creates these tables itself. Investigate before going on." >&2
  exit 1
fi

# The schema file split in two: everything but the foreign keys, then the foreign keys.
python3 - "$CP_SCHEMA" "$OUT_DIR/cp-tables.sql" "$OUT_DIR/cp-fkeys.sql" <<'PY'
import re, sys
src, tables, fkeys = sys.argv[1:]
body = re.sub(r'--[^\n]*', '', open(src).read())  # full-line and trailing comments
stmts = [s.strip() for s in re.split(r';\s*\n', body) if s.strip()]
fk = [s for s in stmts if re.search(r'(?is)\bADD CONSTRAINT\b.*\bFOREIGN KEY\b', s)]
open(tables, 'w').write(';\n'.join(s for s in stmts if s not in fk) + ';\n')
out = []
for s in fk:
    m = re.search(r'(?is)ALTER TABLE (?:ONLY )?(\S+)\s+ADD CONSTRAINT (\S+)\s+FOREIGN KEY', s)
    out.append(f"{s} NOT VALID;\nALTER TABLE {m.group(1)} VALIDATE CONSTRAINT {m.group(2)};")
open(fkeys, 'w').write('\n'.join(out) + '\n')
print(f'{len(stmts) - len(fk)} statements + {len(fk)} foreign keys')
PY

if $DRY_RUN; then echo "Dry run: nothing written (split schema in $OUT_DIR/cp-*.sql)."; exit 0; fi
confirm "Writes must be frozen first (controllers at 0 replicas, CronJobs suspended). Create the tables and copy the rows?"

say "1/4 Create the control-plane tables in jeffi_stores (no foreign keys yet)"
dst -1 -q -f "$OUT_DIR/cp-tables.sql"

say "2/4 Copy the rows (one transaction)"
COPY_TABLES=$(echo "$SRC" | awk '$2 != -1 {print $1}')
pg_docker pg_dump -d jeffi_control_plane --data-only --no-owner --no-privileges \
  $(for t in $COPY_TABLES; do printf -- '-t public.%s ' "$t"; done) > "$OUT_DIR/cp-data.sql"
{
  echo "TRUNCATE $(for t in $TABLES; do printf 'public.%s, ' "$t"; done | sed 's/, $//');"
  cat "$OUT_DIR/cp-data.sql"
  # The platform sentinel (schema.sql seeds it; the source normally has it too).
  echo "INSERT INTO public.tenants (id, slug, display_name, status) VALUES ('00000000-0000-0000-0000-000000000000', 'platform', 'Platform (flagship)', 'active') ON CONFLICT DO NOTHING;"
} | dst -1 -q

say "3/4 Foreign keys"
# Each one on its own: a key whose old rows don't match stays NOT VALID (still enforced for new rows).
dst -v ON_ERROR_STOP=0 -q -f "$OUT_DIR/cp-fkeys.sql" 2> "$OUT_DIR/cp-fkeys.err" || true
if grep -q ERROR "$OUT_DIR/cp-fkeys.err"; then
  echo "Left NOT VALID (rows from before the merge don't match; new rows are checked):"
  grep -oE 'constraint "[a-z0-9_]+"' "$OUT_DIR/cp-fkeys.err" | sort -u | sed 's/^/  /'
fi

say "4/4 seed-plans.sql"
dst -q -f "$REPO/database/control-plane/seed-plans.sql"

say "Source vs target rows"
join <(echo "$SRC") <(counts dst) | awk '{ printf "%-32s %8s %8s %s\n", $1, $2, $3, ($2 == -1 || $2 == $3 || $1 ~ /^plan/) ? "" : "<-- differs" }'
echo "Merged. Next: 30-secrets.sh points every service's control plane at jeffi_stores."
