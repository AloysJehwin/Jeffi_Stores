#!/bin/bash
# Rehearse the DB release before the window on a local copy of production: restore the 00-backup.sh dumps into a
# scratch Postgres of the same major version, then run 10-platform-schema (with 05-table-owner), 20-merge-control-plane
# and verify.sql against it. Nothing touches RDS. Roles mirror RDS: the container's superuser stands in for rdsadmin,
# postgres is a CREATEROLE master that owns the databases, app_user a separate login, and the dumps keep their owners
# and grants, so each step runs as the same user, with the same rights, as in production.
# Usage: bash deploy/k8s/db/rehearse.sh <backup-dir from 00-backup.sh>
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
BK=$(cd "${1:?backup dir}" && pwd)
NAME=jeffi-rehearsal
export REHEARSAL=true REHEARSAL_PW=rehearse PGHOST=127.0.0.1 PGPORT=${REHEARSAL_PORT:-55432} PGSSLMODE=disable
export OUT_DIR=$BK/rehearsal
su() { docker exec -i $NAME psql -U rdsadmin -v ON_ERROR_STOP=1 -q "$@"; }

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -p "127.0.0.1:$PGPORT:5432" -e POSTGRES_USER=rdsadmin -e POSTGRES_PASSWORD=$REHEARSAL_PW \
  "pgvector/pgvector:pg$(cat "$BK/pg_major")" >/dev/null
# TCP, not the socket: the image's init server answers on the socket and then shuts down.
for _ in $(seq 1 60); do pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null && break; sleep 1; done
su -d postgres <<SQL
CREATE ROLE rds_superuser NOLOGIN;
CREATE ROLE postgres LOGIN PASSWORD '$REHEARSAL_PW' CREATEROLE CREATEDB IN ROLE rds_superuser;
CREATE ROLE app_user LOGIN PASSWORD '$REHEARSAL_PW' IN ROLE rds_superuser;
CREATE DATABASE jeffi_stores OWNER postgres;
CREATE DATABASE jeffi_control_plane OWNER postgres;
SQL
for db in jeffi_stores jeffi_control_plane; do
  docker exec -i $NAME pg_restore -U rdsadmin -d $db < "$BK/$db.dump" 2> "$BK/restore-$db.log" ||
    echo "$db: $(grep -c 'error:' "$BK/restore-$db.log") restore error(s) (RDS-only roles and extensions are expected), see $BK/restore-$db.log"
done
su -d jeffi_stores -c 'GRANT CREATE ON SCHEMA public TO app_user'

bash "$DIR/10-platform-schema.sh" --yes
bash "$DIR/20-merge-control-plane.sh" --yes
PGUSER=app_user PGPASSWORD=$REHEARSAL_PW psql -d jeffi_stores -f "$DIR/verify.sql"
echo "Rehearsal done. Inspect: psql postgresql://app_user:$REHEARSAL_PW@127.0.0.1:$PGPORT/jeffi_stores; remove: docker rm -f $NAME"
