#!/bin/bash
# Let app_user alter the older tables (10-platform-schema.sh runs this first). They belong to the RDS master user
# postgres, and app_user (which runs the release and owns every newer table) can't ALTER or index them. As postgres:
# create the role jeffi_owner with postgres and app_user as members, and hand it those objects. Idempotent; writes
# $OUT_DIR/table-owner-rollback.sql (run it as postgres to hand them back).
# Usage: bash deploy/k8s/db/05-table-owner.sh [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
mkdir -p "$OUT_DIR"
tunnel
# Sequences linked to a table move with it, so they are not listed.
LIST=$(psql_app jeffi_stores -At -F ' ' -c "SELECT c.relkind, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') AND c.relowner = 'postgres'::regrole
    AND NOT pg_has_role('app_user', c.relowner, 'USAGE')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a','i'))
  ORDER BY 2")
say "Objects in jeffi_stores owned by postgres that app_user can't alter: $(printf '%s' "$LIST" | grep -c . || true)"
if [ -z "$LIST" ]; then echo "None."; exit 0; fi
if $DRY_RUN; then echo "Dry run: would hand them to the role jeffi_owner (members postgres and app_user)."; exit 0; fi
confirm "Create jeffi_owner and hand these objects to it?"

kind() { case $1 in S) echo SEQUENCE ;; v) echo VIEW ;; m) echo 'MATERIALIZED VIEW' ;; *) echo TABLE ;; esac; }
: > "$OUT_DIR/table-owner-rollback.sql"
{
  echo "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jeffi_owner') THEN CREATE ROLE jeffi_owner NOLOGIN; END IF; END \$\$;"
  echo "GRANT jeffi_owner TO postgres;"
  echo "GRANT jeffi_owner TO app_user;"
  echo "GRANT USAGE, CREATE ON SCHEMA public TO jeffi_owner;"
  printf '%s\n' "$LIST" | while read -r k name; do
    echo "ALTER $(kind "$k") public.\"$name\" OWNER TO jeffi_owner;"
    echo "ALTER $(kind "$k") public.\"$name\" OWNER TO postgres;" >> "$OUT_DIR/table-owner-rollback.sql"
  done
} | psql_master jeffi_stores -1 -q
left=$(psql_app jeffi_stores -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND NOT pg_has_role('app_user', c.relowner, 'USAGE')")
echo "Done; tables app_user still can't alter: $left (expect 0). Rollback: $OUT_DIR/table-owner-rollback.sql"
