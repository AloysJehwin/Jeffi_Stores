#!/bin/bash
# Phase D: a fresh logical dump of the flagship database (prod RDS jeffi_stores, over the core's SSH/SSM tunnel, as
# app_user with an IAM token) restored into the Azure Postgres Flexible Server over the tailnet.
#   dump     pg_dump -Fc of jeffi_stores into ~/Documents/db-backups/rehearsal-<stamp>/ (0700; real customer data).
#            --dump <file> reuses an existing dump (a release's 00-backup.sh one, say) and skips this step.
#   restore  pg_restore as app_user (--no-owner --no-acl: every object becomes app_user's, as pg-init.sh set it up).
#            Refuses a target that already has tables unless --reset.
#   ensure   as the admin (extension ownership, like pg-init.sh): the four extensions and the schema grant.
#   scrub    safe mode (safe-mode.sql), always, right after the restore and before any pod starts: the copy's outbound
#            channels, campaigns, outreach and integration credentials are switched off. --scrub-only does just this.
# Passwords never reach argv, the environment or the output: the RDS IAM token and the Key Vault passwords go into
# 0600 PGPASSFILEs in private temp dirs, removed on exit. Dry run unless --apply.
# Usage: bash deploy/azure/rehearsal/restore-dump.sh [--apply] [--yes] [--target-db jeffi_stores] [--dump FILE]
#          [--dump-only] [--reset] [--jobs 4] [--scrub-only]
# Needs: Postgres created and pg-init.sh applied, az and aws logins, Tailscale up (accepting routes), docker (or a
# local pg_restore of a new enough major), the core's SSH key or session-manager-plugin (lib.sh tunnel).
export JEFFI_CLOUD=azure
source "$(dirname "$0")/common.sh"
TARGET_DB=jeffi_stores; DUMP=; DUMP_ONLY=false; RESET=false; JOBS=4; SCRUB_ONLY=false
args=("$@"); i=0
while [ $i -lt ${#args[@]} ]; do
  case ${args[$i]} in
    --target-db) TARGET_DB=${args[$((i+1))]:?--target-db needs a name}; i=$((i+1)) ;;
    --dump) DUMP=${args[$((i+1))]:?--dump needs a file}; i=$((i+1)) ;;
    --jobs) JOBS=${args[$((i+1))]:?--jobs needs a number}; i=$((i+1)) ;;
    --dump-only) DUMP_ONLY=true ;; --reset) RESET=true ;; --scrub-only) SCRUB_ONLY=true ;;
  esac
  i=$((i+1))
done
[[ $TARGET_DB =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "bad --target-db: $TARGET_DB" >&2; exit 2; }
[[ $JOBS =~ ^[0-9]+$ ]] || { echo "bad --jobs" >&2; exit 2; }
need az aws psql pg_isready python3
BK=${BK:-$BK_ROOT/rehearsal-$RSTAMP}
if [ -n "$DUMP" ]; then
  [ -s "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 1; }
  DUMP=$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")
fi

# --- source (RDS): an IAM token in a 0600 PGPASSFILE. Host and port are wildcards: docker reaches the tunnel as host.docker.internal.
rds_pgpass() {
  local d tok
  d=$(mktemp -d); chmod 700 "$d"; on_exit "rm -rf '$d'"
  tok=$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port 5432 --username app_user | sed 's/[\\:]/\\&/g')
  (umask 077; printf '*:*:*:app_user:%s\n' "$tok" > "$d/pgpass")
  RDS_PGPASS=$d/pgpass
}
# lib.sh's tunnel() follows JEFFI_CLOUD (azure here); the RDS leg is always the SSH/SSM forward to RDS.
tunnel_rds() {
  if listening "$PORT"; then for _ in 1 2 3; do pg_up && return 0; sleep 2; done; fi
  ssh_forward "$PORT" "$RDS_HOST:5432"
  for _ in $(seq 1 15); do pg_up && return 0; sleep 1; done
  echo "Could not open the tunnel to $RDS_HOST through $CORE" >&2; exit 1
}
do_dump() {
  local major
  tunnel_rds
  rds_pgpass
  major=$(PGPASSFILE=$RDS_PGPASS PGSSLMODE=require psql -h 127.0.0.1 -p "$PORT" -U app_user -d jeffi_stores -Atc 'show server_version_num' | cut -c1-2)
  mkdir -p "$BK"; chmod 700 "$BK"
  echo "RDS major $major; dumping jeffi_stores into $BK"
  docker run --rm -e PGHOST=host.docker.internal -e PGPORT="$PORT" -e PGUSER=app_user -e PGSSLMODE=require \
    -e PGPASSFILE=/pg/pgpass -v "$RDS_PGPASS:/pg/pgpass:ro" -v "$BK:/out" "postgres:$major-alpine" \
    pg_dump -d jeffi_stores -Fc -f /out/jeffi_stores.dump
  DUMP=$BK/jeffi_stores.dump; echo "$major" > "$BK/pg_major"
  echo "dump: $(du -h "$DUMP" | cut -f1)"
}

# --- target (Azure). pgtool runs a client as app_user with the pgpass copy in $WORK: local, or in docker with the
# dump dir at /dump and $WORK at /work.
pgtool() {
  if $USE_DOCKER; then
    docker run --rm -e PGHOST="$PG_ADDR" -e PGPORT=5432 -e PGUSER=app_user -e PGSSLMODE=require -e PGPASSFILE=/work/pgpass \
      -v "$WORK:/work" -v "$DUMPDIR:/dump:ro" "postgres:$SRV_MAJOR-alpine" "$@"
  else
    PGHOST=$PG_ADDR PGPORT=5432 PGUSER=app_user PGSSLMODE=require PGPASSFILE=$WORK/pgpass "$@"
  fi
}
do_ensure() {
  psql_master "$TARGET_DB" -q <<'SQL'
GRANT ALL ON SCHEMA public TO app_user;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
  echo "extensions: $(psql_app "$TARGET_DB" -Atc "select string_agg(extname, ',' order by extname) from pg_extension")"
}
do_restore() {
  local log=$BK/restore-$TARGET_DB.log rc=0 src=$DUMP lst=$WORK/restore.list lpath=$WORK/restore.list
  mkdir -p "$BK"
  $USE_DOCKER && { src=/dump/$(basename "$DUMP"); lpath=/work/restore.list; }
  # Extensions come from do_ensure (they need the admin); every other entry is restored as app_user.
  pgtool pg_restore -l "$src" | grep -vE 'EXTENSION - |COMMENT - EXTENSION ' > "$lst"
  pgtool pg_restore -d "$TARGET_DB" --no-owner --no-acl -L "$lpath" -j "$JOBS" "$src" 2> "$log" || rc=$?
  echo "pg_restore exit $rc, $(grep -c 'error:' "$log" || true) error line(s); log $log"
  [ "$rc" = 0 ] || echo "(a few errors are usual: read the log for anything that is not a missing role or extension)"
}
verify() {
  local src=$DUMP; $USE_DOCKER && src=/dump/$(basename "$DUMP")
  psql_app "$TARGET_DB" -Atc "select count(*) || ' tables in public, ' || pg_size_pretty(pg_database_size(current_database())) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
  echo "tables with data in the dump: $(pgtool pg_restore -l "$src" | grep -c ' TABLE DATA ')"
}

say "Plan"
echo "source:  RDS $RDS_HOST / jeffi_stores$([ -n "$DUMP" ] && echo "  (reusing $DUMP: no fresh dump)")"
echo "target:  $AZ_PG_HOST / $TARGET_DB (restore as app_user; extensions and schema grant as $AZ_PG_ADMIN)"
echo "output:  $BK"
echo "then:    safe-mode scrub of the copy (safe-mode.sql; the Azure database only)"
if ! $APPLY; then
  if ! $DUMP_ONLY; then
    say "Read-only check of the target"
    tunnel
    echo "Azure Postgres $PG_ADDR: $(psql_master postgres -Atc 'select version()' | cut -c1-60)"
    echo "$TARGET_DB exists: $(psql_master postgres -Atc "select count(*) from pg_database where datname='$TARGET_DB'")"
  fi
  echo; echo "Dry run: nothing dumped or restored (--apply)."; exit 0
fi

if $SCRUB_ONLY; then
  tunnel; timed safe-mode-db db_scrub "$TARGET_DB"; print_times; exit 0
fi
if [ -z "$DUMP" ]; then
  confirm "Dump prod jeffi_stores (read-only on RDS) into $BK?"
  timed dump do_dump
fi
if $DUMP_ONLY; then print_times; echo "Dump: $DUMP"; exit 0; fi
need docker
tunnel # Azure: PG_ADDR and the PGPASSFILE with app_user's and the admin's passwords
SRV_MAJOR=$(psql_master postgres -Atc 'show server_version_num' | cut -c1-2)
USE_DOCKER=true
dump_major=0; [ -s "$(dirname "$DUMP")/pg_major" ] && dump_major=$(cat "$(dirname "$DUMP")/pg_major")
if command -v pg_restore >/dev/null; then
  lm=$(pg_restore --version | major_of)
  [ "$lm" -ge "$SRV_MAJOR" ] && [ "$lm" -ge "$dump_major" ] && USE_DOCKER=false
fi
WORK=$(mktemp -d); chmod 700 "$WORK"; on_exit "rm -rf '$WORK'"
cp "$PGPASSFILE" "$WORK/pgpass"; chmod 600 "$WORK/pgpass"
DUMPDIR=$(dirname "$DUMP")
echo "Azure Postgres major $SRV_MAJOR; restore tools: $($USE_DOCKER && echo "docker postgres:$SRV_MAJOR-alpine" || echo local)"

if [ "$(psql_master postgres -Atc "select count(*) from pg_database where datname='$TARGET_DB'")" = 0 ]; then
  confirm "Create database $TARGET_DB owned by app_user on $AZ_PG_HOST?"
  psql_master postgres -qc "CREATE DATABASE $TARGET_DB OWNER app_user"
fi
n=$(psql_app "$TARGET_DB" -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')")
if [ "$n" -gt 0 ]; then
  $RESET || { echo "$TARGET_DB already has $n tables. Re-run with --reset to drop schema public first." >&2; exit 1; }
  confirm "DROP SCHEMA public CASCADE in $TARGET_DB on $AZ_PG_HOST ($n tables)?"
  timed reset psql_master "$TARGET_DB" -q -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public'
fi
timed ensure-extensions do_ensure
timed restore do_restore
timed ensure-extensions-after do_ensure
timed verify verify
timed safe-mode-db db_scrub "$TARGET_DB"
print_times
say "Done. Next: bash deploy/k8s/db/release-db.sh --cloud=azure --dry-run, then bash deploy/azure/rehearsal/rehearse.sh"
