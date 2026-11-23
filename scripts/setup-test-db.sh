#!/usr/bin/env bash
# Create + schema-load + seed the jeffi_test database for DB-backed API tests.
# LOCAL ONLY convenience wrapper. The real local DB (jeffi_production_ready) is never touched.
# CI performs the equivalent steps inline in the api-db-tests job against its ephemeral Postgres.
#
# Usage: bash scripts/setup-test-db.sh [DB_URL]
#   DB_URL defaults to postgresql://$USER@localhost:5432/jeffi_test
set -euo pipefail

DB_NAME="jeffi_test"
DB_URL="${1:-postgresql://$USER@localhost:5432/$DB_NAME}"

# Safety: this script must only ever target jeffi_test.
case "$DB_URL" in
  */jeffi_test) : ;;
  *) echo "REFUSING: setup-test-db targets only 'jeffi_test', got: $DB_URL" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> ensuring database $DB_NAME exists"
createdb "$DB_NAME" 2>/dev/null && echo "   created" || echo "   already exists"

echo "==> loading schema (platform + control-plane sets, manifest order)"
err="$(mktemp)"
for f in $(node scripts/db-files.mjs platform) $(node scripts/db-files.mjs control-plane); do
  psql "$DB_URL" -v ON_ERROR_STOP=0 -q -f "$f" >/dev/null 2>"$err" || echo "   warn $f: $(head -c 200 "$err")"
done
rm -f "$err"

echo "==> smoke check (core tables exist)"
psql "$DB_URL" -Atc "SELECT 1 FROM products, orders, cart_items, users, auth_sessions LIMIT 1" >/dev/null \
  && echo "   core tables present" || { echo "   MISSING core tables" >&2; exit 1; }

echo "==> seeding test fixtures"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/seed-test-db.sql
echo "==> done. jeffi_test ready. Run: npm run test:db"
