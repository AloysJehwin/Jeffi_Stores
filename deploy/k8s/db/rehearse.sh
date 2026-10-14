#!/bin/bash
# Rehearse the DB release before the window on a local copy of production: restore the 00-backup.sh dumps
# into a scratch Postgres of the same major version, then run 10-platform-schema, 20-merge-control-plane and
# verify.sql against it. Nothing touches RDS. It runs as a superuser, so it checks SQL and data, not grants.
# Usage: bash deploy/k8s/db/rehearse.sh <backup-dir from 00-backup.sh>
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
BK=$(cd "${1:?backup dir}" && pwd)
NAME=jeffi-rehearsal
export REHEARSAL=true PGHOST=127.0.0.1 PGPORT=${REHEARSAL_PORT:-55432} PGUSER=postgres PGPASSWORD=rehearse PGSSLMODE=disable
export OUT_DIR=$BK/rehearsal

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -p "127.0.0.1:$PGPORT:5432" -e POSTGRES_PASSWORD=$PGPASSWORD "pgvector/pgvector:pg$(cat "$BK/pg_major")" >/dev/null
for _ in $(seq 1 30); do psql -d postgres -qc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
for db in jeffi_stores jeffi_control_plane; do
  psql -d postgres -qc "CREATE DATABASE $db"
  docker exec -i $NAME pg_restore -U postgres --no-owner --no-privileges -d $db < "$BK/$db.dump" 2> "$BK/restore-$db.log" ||
    echo "$db: $(grep -c 'error:' "$BK/restore-$db.log") restore error(s) (RDS-only extensions are expected), see $BK/restore-$db.log"
done

bash "$DIR/10-platform-schema.sh" --yes
bash "$DIR/20-merge-control-plane.sh" --yes
psql -d jeffi_stores -f "$DIR/verify.sql"
echo "Rehearsal done. Inspect: psql postgresql://postgres:$PGPASSWORD@127.0.0.1:$PGPORT/jeffi_stores; remove: docker rm -f $NAME"
