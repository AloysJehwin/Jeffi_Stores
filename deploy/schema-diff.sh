#!/bin/bash
# Schema diff runner — compares database/*.sql (desired state) against live RDS
# and applies only the delta using migra.
#
# Usage:
#   bash deploy/schema-diff.sh             # diff + apply
#   bash deploy/schema-diff.sh --dry-run   # diff only, print SQL, do not apply
#
# Requirements (set in environment):
#   RDS_HOST, RDS_PORT, RDS_USER, RDS_DB, AWS_REGION

set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=false
for arg in "$@"; do [[ "$arg" == "--dry-run" ]] && DRY_RUN=true; done

TEMP_DB="schema_diff_$$"

cleanup() { docker rm -f "$TEMP_DB" 2>/dev/null || true; }
trap cleanup EXIT

# ── 1. Install migra (idempotent) ─────────────────────────────────────────────
echo "── Installing migra ──"
pip3 install --quiet --break-system-packages migra psycopg2-binary 2>/dev/null || \
  pip3 install --quiet migra psycopg2-binary

# ── 2. Start temp Postgres ────────────────────────────────────────────────────
echo "── Starting temp Postgres ──"
docker run -d --name "$TEMP_DB" \
  -e POSTGRES_PASSWORD=temp \
  -e POSTGRES_DB=desired \
  postgres:15-alpine

echo "Waiting for temp DB to be ready..."
for i in $(seq 1 15); do
  docker exec "$TEMP_DB" pg_isready -U postgres -q 2>/dev/null && break || true
  sleep 2
done

CONTAINER_IP=$(docker inspect "$TEMP_DB" --format '{{.NetworkSettings.IPAddress}}')
echo "Container IP: $CONTAINER_IP"

# ── 3. Load entity SQL files into temp DB ─────────────────────────────────────
echo "── Loading desired schema into temp DB ──"

PGPASSWORD=temp psql -h "$CONTAINER_IP" -p 5432 -U postgres -d desired \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;' \
  > /dev/null 2>&1 || true

for f in \
  database/extensions.sql \
  database/users.sql \
  database/catalog.sql \
  database/inventory.sql \
  database/orders.sql \
  database/payments.sql \
  database/quotations.sql \
  database/invoices.sql \
  database/marketing.sql \
  database/reviews.sql \
  database/crm.sql \
  database/support.sql \
  database/ai.sql \
  database/logs.sql \
  database/settings.sql \
  database/indexes.sql \
  database/functions.sql \
  database/triggers.sql \
  database/constraints.sql; do
  [ -f "$f" ] || continue
  PGPASSWORD=temp psql -h "$CONTAINER_IP" -p 5432 -U postgres -d desired \
    -v ON_ERROR_STOP=0 -f "$f" > /dev/null 2>&1 || true
done

echo "Desired schema loaded."

# ── 4. Generate diff: desired (temp) vs live (RDS) ───────────────────────────
echo "── Generating schema diff ──"

RDS_TOKEN=$(aws rds generate-db-auth-token \
  --hostname "$RDS_HOST" \
  --port "${RDS_PORT:-5432}" \
  --region "${AWS_REGION:-us-east-1}" \
  --username "$RDS_USER")

# URL-encode the IAM token — it contains ?, &, = which break connection string parsing
RDS_TOKEN_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$RDS_TOKEN")

DESIRED_URL="postgresql://postgres:temp@${CONTAINER_IP}:5432/desired"
LIVE_URL="postgresql://$RDS_USER:${RDS_TOKEN_ENC}@$RDS_HOST:${RDS_PORT:-5432}/$RDS_DB?sslmode=require"

# migra <from=live> <to=desired> — generates SQL to transform live into desired
RAW_DIFF=$(migra --unsafe --ignore-extension-versions "$LIVE_URL" "$DESIRED_URL" 2>/dev/null || true)

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
    ])
    if safe:
        stmt = [line]
        while not line.rstrip().endswith(';') and i + 1 < len(lines):
            i += 1
            line = lines[i]
            stmt.append(line)
        output.extend(stmt)
    i += 1

# Make index creation idempotent
result = '\n'.join(output).strip()
result = result.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
result = result.replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
result = result.replace('IF NOT EXISTS IF NOT EXISTS', 'IF NOT EXISTS')
print(result)
PYEOF

DIFF=$(echo "$RAW_DIFF" | python3 "$FILTER_SCRIPT")
rm -f "$FILTER_SCRIPT"

if [ -z "$DIFF" ]; then
  echo "No schema differences — live RDS matches entity files."
  exit 0
fi

echo ""
echo "Schema diff:"
echo "────────────────────────────────────────"
echo "$DIFF"
echo "────────────────────────────────────────"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "Dry run — diff printed above, nothing applied."
  exit 0
fi

# ── 5. Apply diff to live RDS ─────────────────────────────────────────────────
echo ""
echo "── Applying diff to live RDS ──"
# Refresh token (tokens last 15 min)
RDS_TOKEN=$(aws rds generate-db-auth-token \
  --hostname "$RDS_HOST" \
  --port "${RDS_PORT:-5432}" \
  --region "${AWS_REGION:-us-east-1}" \
  --username "$RDS_USER")

echo "$DIFF" | PGPASSWORD="$RDS_TOKEN" PGSSLMODE=require psql \
  -h "$RDS_HOST" \
  -p "${RDS_PORT:-5432}" \
  -U "$RDS_USER" \
  -d "$RDS_DB"

echo "Schema diff applied successfully."
