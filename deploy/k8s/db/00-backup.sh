#!/bin/bash
# Step 0, inside the write freeze: an RDS snapshot plus pg_dump (custom format) of jeffi_stores and
# jeffi_control_plane into $OUT_DIR. The dumps also feed rehearse.sh.
# Usage: bash deploy/k8s/db/00-backup.sh [--dry-run] [--yes] [--dumps-only]
source "$(dirname "$0")/lib.sh"
DUMPS_ONLY=false; for a in "$@"; do case $a in --dumps-only) DUMPS_ONLY=true ;; esac; done
SNAP=$RDS_INSTANCE-pre-release-$STAMP
DBS="jeffi_stores jeffi_control_plane"

say "RDS instance (status, class, engine, GB) and latest snapshots"
aws rds describe-db-instances --db-instance-identifier "$RDS_INSTANCE" \
  --query 'DBInstances[0].[DBInstanceStatus,DBInstanceClass,EngineVersion,AllocatedStorage]' --output text
aws rds describe-db-snapshots --db-instance-identifier "$RDS_INSTANCE" \
  --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[:3].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' --output text
tunnel
say "Database sizes"
psql_app jeffi_stores -Atc "SELECT datname || '  ' || pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname IN ('jeffi_stores', 'jeffi_control_plane')"
say "Tables in jeffi_stores app_user can't alter, by owner (05-table-owner.sh hands postgres's to jeffi_owner)"
psql_app jeffi_stores -Atc "SELECT pg_get_userbyid(c.relowner) || ': ' || count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  AND NOT pg_has_role(current_user, c.relowner, 'USAGE') GROUP BY 1"

if $DRY_RUN; then echo "Dry run: would snapshot $SNAP and dump $DBS into $OUT_DIR."; exit 0; fi
confirm "Writes must be frozen first. Snapshot $RDS_INSTANCE and dump $DBS?"
mkdir -p "$OUT_DIR"

if ! $DUMPS_ONLY; then
  say "Snapshot $SNAP (dumps run while it is taken)"
  aws rds create-db-snapshot --db-instance-identifier "$RDS_INSTANCE" --db-snapshot-identifier "$SNAP" \
    --query DBSnapshot.Status --output text
fi
pg_major > "$OUT_DIR/pg_major"
for db in $DBS; do
  say "pg_dump $db"
  pg_docker pg_dump -d "$db" -Fc -f "/out/$db.dump"
  echo "$(pg_docker pg_restore -l "/out/$db.dump" | grep -c ' TABLE DATA ') tables with data, $(du -h "$OUT_DIR/$db.dump" | cut -f1)"
done
if $DUMPS_ONLY; then echo "Dumps in $OUT_DIR"; exit 0; fi
say "Waiting for the snapshot"
aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP"
echo "Backed up: snapshot $SNAP, dumps in $OUT_DIR"
echo "Restore the instance from the snapshot: aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier $SNAP --db-instance-identifier <new-id>"
