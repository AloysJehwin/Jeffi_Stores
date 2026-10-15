#!/bin/bash
# Schema diff runner — compares database/*.sql (desired state) against live RDS
# and applies only the delta using migra.
#
# Usage:
#   bash deploy/schema-diff.sh [--set=platform|control-plane]          # diff + apply
#   bash deploy/schema-diff.sh [--set=...] --dry-run                   # diff only; nothing is written (no seed)
#
# Requirements (set in environment):
#   RDS_HOST, RDS_PORT, RDS_USER, RDS_DB, AWS_REGION (RDS_CONNECT_HOST/RDS_CONNECT_PORT: where to connect,
#   e.g. a tunnel; the IAM token stays signed for RDS_HOST:RDS_PORT). --no-seed skips seed-plans.sql.
#   or TARGET_URL=postgresql://user:pass@host:port/db for a non-IAM target (local rehearsal).
# The planned SQL is also written to $SCHEMA_DIFF_OUT (default /tmp)/schema-<set>-<db>.sql.
# Needs docker, python3 (migra goes into a venv under ~/.cache) and psql.

set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=false; NO_SEED=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
  [[ "$arg" == "--no-seed" ]] && NO_SEED=true
done

TEMP_DB="schema_diff_$$"

cleanup() { docker rm -fv "$TEMP_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# psql against the target (IAM token, or TARGET_URL).
target_psql() {
  if [ -n "${TARGET_URL:-}" ]; then psql "$TARGET_URL" "$@"; return; fi
  PGPASSWORD="$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port "${RDS_PORT:-5432}" \
    --region "${AWS_REGION:-us-east-1}" --username "$RDS_USER")" PGSSLMODE=require \
    psql -h "${RDS_CONNECT_HOST:-$RDS_HOST}" -p "${RDS_CONNECT_PORT:-${RDS_PORT:-5432}}" -U "$RDS_USER" -d "$RDS_DB" "$@"
}

# seed-plans.sql is row data (plans + plan_features), not structure, so migra never sees it.
# It is transactional and authoritative (upsert + prune), so re-running on every deploy keeps
# plan entitlements in step with the seed. Only meaningful for the control-plane set. Never in a dry run.
seed_control_plane() {
  [ "${SCHEMA_SET:-}" = "control-plane" ] || return 0
  [ -f database/control-plane/seed-plans.sql ] || return 0
  if [ "$DRY_RUN" = "true" ]; then echo "(dry run: control-plane seed not applied)"; return 0; fi
  if [ "$NO_SEED" = "true" ]; then echo "(--no-seed: control-plane seed skipped)"; return 0; fi
  echo ""
  echo "── Seeding control-plane plans/entitlements ──"
  local SEED_LOG
  SEED_LOG=$(mktemp /tmp/schema_seed_XXXXXX.log)
  target_psql -v ON_ERROR_STOP=1 -f database/control-plane/seed-plans.sql 2>&1 | tee "$SEED_LOG"
  if grep -q '^ERROR:' "$SEED_LOG"; then
    echo ""
    echo "seed-plans.sql FAILED — plan entitlements not updated."
    grep '^ERROR:' "$SEED_LOG" | sed 's/^/  /'
    rm -f "$SEED_LOG"
    exit 1
  fi
  rm -f "$SEED_LOG"
  echo "Control-plane seed applied."
}

# ── 1. Install migra (idempotent, in a venv so a managed system Python is left alone) ──
echo "── Installing migra ──"
VENV=${MIGRA_VENV:-$HOME/.cache/jeffi-migra}
[ -x "$VENV/bin/migra" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" install --quiet migra psycopg2-binary "psycopg[binary]" "setuptools<81"; }
MIGRA="$VENV/bin/migra"

# ── 2. Start temp Postgres ────────────────────────────────────────────────────
# pgvector image: ai.sql's vector tables must exist in the desired state too. A published localhost
# port (not the bridge IP) so this works from Docker Desktop on a Mac as well as on Linux.
echo "── Starting temp Postgres ──"
# Same major version as the target, so index/CHECK text normalizes the same way on both sides.
PG_MAJOR=$(target_psql -Atc "show server_version_num" | cut -c1-2)
docker run -d --name "$TEMP_DB" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=temp \
  -e POSTGRES_DB=desired \
  "pgvector/pgvector:pg${PG_MAJOR:-16}" >/dev/null

echo "Waiting for temp DB to be ready..."
for i in $(seq 1 15); do
  docker exec "$TEMP_DB" pg_isready -U postgres -q 2>/dev/null && break || true
  sleep 2
done
TEMP_PORT=$(docker port "$TEMP_DB" 5432/tcp | head -1 | sed 's/.*://')
TEMP_URL="postgresql://postgres:temp@127.0.0.1:${TEMP_PORT}/desired"
for i in $(seq 1 15); do psql "$TEMP_URL" -qc 'select 1' >/dev/null 2>&1 && break || sleep 1; done

# ── 3. Load entity SQL files into temp DB ─────────────────────────────────────
echo "── Loading desired schema into temp DB ──"

psql "$TEMP_URL" -q \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS vector;' \
  > /dev/null

# Which schema set to diff. `platform` = the main store DB (default);
# `control-plane` = the SaaS control-plane tables (database/control-plane/schema.sql).
SCHEMA_SET="${SCHEMA_SET:-platform}"
for arg in "$@"; do
  case "$arg" in --set=*) SCHEMA_SET="${arg#--set=}" ;; esac
done
echo "Schema set: $SCHEMA_SET"

if [ "$SCHEMA_SET" = "control-plane" ]; then
  SCHEMA_FILES="database/control-plane/schema.sql"
else
  # Load EVERY database/*.sql, discovered at runtime. Ordering still matters: extensions
  # first, then topic/table files, then the files that reference tables.
  TAIL_FILES="indexes.sql functions.sql triggers.sql constraints.sql"
  SCHEMA_FILES=""
  [ -f database/extensions.sql ] && SCHEMA_FILES="database/extensions.sql"
  for f in database/*.sql; do
    b="$(basename "$f")"
    case " extensions.sql $TAIL_FILES " in *" $b "*) continue ;; esac
    SCHEMA_FILES="$SCHEMA_FILES
$f"
  done
  for b in $TAIL_FILES; do
    [ -f "database/$b" ] && SCHEMA_FILES="$SCHEMA_FILES
database/$b"
  done
fi

LOAD_LOG=$(mktemp /tmp/schema_load_XXXXXX.log)
for f in $SCHEMA_FILES; do
  [ -f "$f" ] || continue
  psql "$TEMP_URL" -v ON_ERROR_STOP=0 -f "$f" 2>&1 | grep -E '(^|: )ERROR:' >> "$LOAD_LOG" || true
done
if [ -s "$LOAD_LOG" ]; then
  echo "$(wc -l < "$LOAD_LOG" | tr -d ' ') error(s) loading the desired schema. Foreign keys in topic files load before the keys"
  echo "they reference and the diff never applies FKs, so those are expected; anything else needs a look:"
  head -20 "$LOAD_LOG" | sed 's/^/  /'
fi
rm -f "$LOAD_LOG"
echo "Desired schema loaded."

# ── 4. Generate diff: desired (temp) vs live (RDS) ───────────────────────────
echo "── Generating schema diff ──"

if [ -n "${TARGET_URL:-}" ]; then
  LIVE_URL="$TARGET_URL"
else
  RDS_TOKEN=$(aws rds generate-db-auth-token \
    --hostname "$RDS_HOST" \
    --port "${RDS_PORT:-5432}" \
    --region "${AWS_REGION:-us-east-1}" \
    --username "$RDS_USER")
  # URL-encode the IAM token — it contains ?, &, = which break connection string parsing
  RDS_TOKEN_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$RDS_TOKEN")
  LIVE_URL="postgresql://$RDS_USER:${RDS_TOKEN_ENC}@${RDS_CONNECT_HOST:-$RDS_HOST}:${RDS_CONNECT_PORT:-${RDS_PORT:-5432}}/$RDS_DB?sslmode=require"
fi
DESIRED_URL="$TEMP_URL"

# migra <from=live> <to=desired> — SQL that turns live into desired.
# Exit 0 = no differences, 2 = differences; anything else is a failure, never "no diff".
MIGRA_ERR=$(mktemp /tmp/migra_err_XXXXXX.log)
set +e
RAW_DIFF=$("$MIGRA" --unsafe --ignore-extension-versions "$LIVE_URL" "$DESIRED_URL" 2>"$MIGRA_ERR")
MIGRA_RC=$?
set -e
if [ "$MIGRA_RC" -ne 0 ] && [ "$MIGRA_RC" -ne 2 ]; then
  echo "migra failed (exit $MIGRA_RC):"
  sed 's/^/  /' "$MIGRA_ERR"
  rm -f "$MIGRA_ERR"
  exit 1
fi
rm -f "$MIGRA_ERR"

# Filter to only safe additive statements — never apply drops automatically.
# Destructive changes (DROP COLUMN, DROP TABLE) go through database/migrations/.
FILTER_SCRIPT=$(mktemp /tmp/migra_filter_XXXXXX.py)
cat > "$FILTER_SCRIPT" << 'PYEOF'
import sys

lines = sys.stdin.read().split('\n')
output = []
i = 0
while i < len(lines):
    line = lines[i]
    upper = line.strip().upper()
    if not line.strip():
        if output and output[-1] != '':
            output.append('')
        i += 1
        continue
    safe = any([
        upper.startswith('ALTER TABLE') and 'ADD COLUMN' in upper,
        upper.startswith('CREATE TABLE'),
        upper.startswith('CREATE INDEX') or upper.startswith('CREATE UNIQUE INDEX'),
        upper.startswith('CREATE EXTENSION'),
        upper.startswith('CREATE SEQUENCE'),
        upper.startswith('ALTER TABLE') and 'ADD CONSTRAINT' in upper and 'PRIMARY KEY' in upper,
        upper.startswith('ALTER TABLE') and 'ADD CONSTRAINT' in upper and 'UNIQUE' in upper,
        # CHECK constraints are validation rules and carry no data, so they are safe to
        # add. Without this every CHECK change was silently dropped from the diff - which
        # is how live ended up missing 'owner' from auth_sessions_principal_type_check and
        # breaking every ecom owner sign-in.
        upper.startswith('ALTER TABLE') and 'ADD CONSTRAINT' in upper and 'CHECK' in upper,
    ])
    if safe:
        stmt = [line]
        while not line.rstrip().endswith(';') and i + 1 < len(lines):
            i += 1
            line = lines[i]
            stmt.append(line)
        output.extend(stmt)
    i += 1

# A CHANGED check constraint makes migra emit DROP + ADD; the DROP is filtered out as
# unsafe, so the ADD would fail with "already exists" and the constraint would never be
# updated. Prefix each CHECK add with a DROP IF EXISTS so it is self-healing. Safe because
# dropping a CHECK removes only a validation rule.
import re as _re


# Same failure shape for PRIMARY KEY, but the ADD cannot simply be prefixed with a DROP:
# dropping the old constraint also drops the index that "USING INDEX" then needs. Replace
# the ADD with a block that no-ops when the PK is already right, and otherwise reads the
# column list out of the existing index before freeing the name.
def _pk_adopt(_tbl, _con):
    return f"""DO $jeffi$
DECLARE v_cols text; v_idx oid; v_con text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
               JOIN pg_class t ON t.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public' AND t.relname = '{_tbl}' AND c.contype = 'p') THEN
    RAISE NOTICE 'primary key already present on public.{_tbl} - skipping';
    RETURN;
  END IF;
  SELECT i.indexrelid INTO v_idx
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
   WHERE n.nspname = 'public' AND ic.relname = '{_con}';
  IF v_idx IS NULL THEN
    RAISE NOTICE 'index {_con} not found - leaving public.{_tbl} alone';
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) INTO v_cols
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = v_idx;
  SELECT c.conname INTO v_con FROM pg_constraint c WHERE c.conindid = v_idx;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', '{_tbl}', v_con);
  ELSE
    EXECUTE format('DROP INDEX public.%I', '{_con}');
  END IF;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (%s)', '{_tbl}', '{_con}', v_cols);
  RAISE NOTICE 'adopted primary key {_con} on public.{_tbl} (%)', v_cols;
END
$jeffi$;"""


_healed = []
for _stmt in '\n'.join(output).split(';'):
    _s = _stmt.strip()
    if not _s:
        continue
    _m = _re.match(r'(?is)^\s*alter\s+table\s+(?:only\s+)?(\S+)\s+add\s+constraint\s+(\S+)\s+check\b', _s)
    if _m:
        _healed.append(f'ALTER TABLE {_m.group(1)} DROP CONSTRAINT IF EXISTS {_m.group(2)};')
    _pk = _re.match(r'(?is)^\s*alter\s+table\s+(?:only\s+)?(\S+)\s+add\s+constraint\s+(\S+)\s+primary\s+key\b', _s)
    if _pk:
        _healed.append(_pk_adopt(_pk.group(1).split('.')[-1].strip('"'), _pk.group(2).strip('"')))
        continue
    _healed.append(_s + ';')
output = _healed

# Make index creation idempotent. migra emits lowercase DDL, so these rewrites must be
# case-insensitive - matching only the uppercase form meant they never fired and a re-run
# failed on indexes that already existed.
result = '\n'.join(output).strip()
result = _re.sub(r'(?i)\bcreate(\s+unique)?\s+index\s+(?!if\s+not\s+exists)',
                 lambda m: 'CREATE' + (' UNIQUE' if m.group(1) else '') + ' INDEX IF NOT EXISTS ',
                 result)
print(result)
PYEOF


DIFF=$(echo "$RAW_DIFF" | python3 "$FILTER_SCRIPT")
rm -f "$FILTER_SCRIPT"

OUT="${SCHEMA_DIFF_OUT:-/tmp}/schema-${SCHEMA_SET}-${RDS_DB:-target}.sql"
printf '%s\n' "$DIFF" > "$OUT"

if [ -z "$DIFF" ]; then
  echo "No schema differences — live matches the entity files."
  seed_control_plane
  exit 0
fi

echo ""
echo "Schema diff (also in $OUT):"
echo "────────────────────────────────────────"
echo "$DIFF"
echo "────────────────────────────────────────"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "Dry run — diff printed above, nothing applied."
  exit 0
fi

# ── 5. Apply diff ─────────────────────────────────────────────────────────────
echo ""
echo "── Applying diff ──"
# psql without ON_ERROR_STOP continues past failures and still exits 0, so capture the output,
# surface any ERROR lines, and fail.
APPLY_LOG=$(mktemp /tmp/schema_apply_XXXXXX.log)
echo "$DIFF" | target_psql 2>&1 | tee "$APPLY_LOG"

ERRORS=$(grep -c '^ERROR:' "$APPLY_LOG" || true)
if [ "${ERRORS:-0}" -gt 0 ]; then
  echo ""
  echo "──────────────────────────────────────────────"
  echo "$ERRORS statement(s) FAILED while applying to ${RDS_DB:-target} ($SCHEMA_SET):"
  grep '^ERROR:' "$APPLY_LOG" | sed 's/^/  /'
  echo "──────────────────────────────────────────────"
  echo "The schema files and the live database disagree in a way the diff cannot"
  echo "reconcile automatically - usually a column type that differs between them."
  rm -f "$APPLY_LOG"
  exit 1
fi
rm -f "$APPLY_LOG"

# ── 6. Seed control-plane reference data ──────────────────────────────────────
echo "Schema diff applied successfully ($SCHEMA_SET -> ${RDS_DB:-target})."
seed_control_plane
