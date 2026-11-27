#!/bin/bash
# The cutover's final data copy, run inside the cluster: the SSM tunnel stalled twice in the rehearsal, a pod on the AWS
# tenant edge did not (deploy/azure/rehearsal/README.md, "If the SSM tunnel stalls"). Steps:
#   1. reset the Azure jeffi_stores: drop schema public, recreate it for app_user, the four extensions as the admin
#   2. a one-off postgres:16-alpine pod in jeffi, pinned to the edge (inside the VPC, next to RDS)
#   3. a 0600 PGPASSFILE written into the pod over stdin (RDS IAM token + app_user's Key Vault password; never in argv,
#      the environment or a log)
#   4. in the pod, detached: pg_dump -Fc from RDS, a full read-back, pg_restore --no-owner --no-acl -j 4 (extension
#      entries left out) into flagship-postgres over the cluster network
#   5. the restore log copied to RUN_DIR, table counts compared, the pod deleted (it holds the dump and the password)
# Called by cutover.sh final-dump-restore (DUMP_VIA=edge, the default). Usage: RUN_DIR=<dir> bash edge-copy.sh
set -euo pipefail
export JEFFI_CLOUD=azure
source "$(dirname "$0")/../../k8s/db/lib.sh"
RUN_DIR=${RUN_DIR:?RUN_DIR is required}
export KUBECONFIG=${AZ_KUBECONFIG:-$HOME/.kube/jeffi-azure.yaml}
NS=jeffi POD=cutover-copy
EDGE_NODE=${EDGE_NODE:-tenant-edge}
TIMEOUT_MIN=${COPY_TIMEOUT_MIN:-30}
k() { kubectl -n "$NS" "$@"; }
drop_pod() { k delete pod "$POD" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }
on_exit drop_pod

say "Reset the Azure jeffi_stores (schema public recreated for app_user; extensions as $AZ_PG_ADMIN)"
tunnel
psql_master jeffi_stores -q <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION app_user;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
SQL
echo "   empty: $(psql_app jeffi_stores -Atc "select count(*) from pg_tables where schemaname = 'public'") public tables"

say "Copy pod on $EDGE_NODE"
drop_pod
k wait --for=delete "pod/$POD" --timeout=60s >/dev/null 2>&1 || true
k apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata: { name: $POD, namespace: $NS, labels: { app: cutover-copy } }
spec:
  restartPolicy: Never
  nodeSelector: { kubernetes.io/hostname: $EDGE_NODE }
  tolerations: [{ key: jeffi.io/edge, operator: Equal, value: "true", effect: NoSchedule }]
  containers:
    - name: pg
      image: postgres:16-alpine
      command: [sleep, "7200"]
      resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { memory: 2Gi } }
YAML
k wait --for=condition=Ready "pod/$POD" --timeout=300s >/dev/null
echo "   ready"

umask 077
d=$(mktemp -d); chmod 700 "$d"; on_exit "rm -rf '$d'"
esc() { sed 's/[\\:]/\\&/g'; }
{
  printf '%s:5432:jeffi_stores:app_user:%s\n' "$RDS_HOST" "$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port 5432 --username app_user --region "$AWS_REGION" | esc)"
  printf '%s:5432:jeffi_stores:app_user:%s\n' "$AZ_PG_HOST" "$(kv_secret pg-app-password | esc)"
} > "$d/pgpass"
# End with output: kubectl may drop a short stdin when the command prints nothing.
lines=$(k exec -i "$POD" -- sh -c 'umask 077; cat > /tmp/pgpass && wc -l < /tmp/pgpass' < "$d/pgpass")
rm -f "$d/pgpass"
[ "$lines" = 2 ] || die "password file did not reach the pod ($lines lines)"

k exec -i "$POD" -- sh -c 'cat > /tmp/run.sh && wc -c < /tmp/run.sh' >/dev/null <<'RUN'
set -u
export PGPASSFILE=/tmp/pgpass PGSSLMODE=require
t0=$(date +%s)
pg_dump -h "$H_RDS" -U app_user -d jeffi_stores -Fc -f /tmp/jeffi_stores.dump
rc=$?; echo "dump: exit $rc, $(( $(date +%s) - t0 ))s, $(du -h /tmp/jeffi_stores.dump 2>/dev/null | cut -f1)"
[ $rc = 0 ] || { echo dump > /tmp/done; exit 1; }
pg_restore -f /dev/null /tmp/jeffi_stores.dump || { echo "read-back failed"; echo readback > /tmp/done; exit 1; }
echo "read-back: ok"
pg_restore -l /tmp/jeffi_stores.dump | grep -v ' EXTENSION ' > /tmp/list
grep -cE '; [0-9]+ [0-9]+ TABLE public ' /tmp/list > /tmp/tables
t1=$(date +%s)
pg_restore --no-owner --no-acl -L /tmp/list -j 4 -h "$H_AZ" -U app_user -d jeffi_stores /tmp/jeffi_stores.dump > /tmp/restore.log 2>&1
rc=$?; echo "restore: exit $rc, $(( $(date +%s) - t1 ))s, $(grep -c '^pg_restore: error' /tmp/restore.log) error line(s)"
echo "$rc" > /tmp/done
RUN
k exec "$POD" -- env H_RDS="$RDS_HOST" H_AZ="$AZ_PG_HOST" sh -c 'nohup sh /tmp/run.sh > /tmp/run.log 2>&1 & echo started'

say "Dump from RDS and restore into Azure (in the pod; up to $TIMEOUT_MIN min)"
done=
for _ in $(seq 1 $((TIMEOUT_MIN * 6))); do
  done=$(k exec "$POD" -- sh -c 'cat /tmp/done 2>/dev/null || true' 2>/dev/null || true)
  [ -n "$done" ] && break
  sleep 10
done
k exec "$POD" -- cat /tmp/run.log | sed 's/^/   /'
k exec "$POD" -- sh -c 'cat /tmp/restore.log 2>/dev/null || true' > "$RUN_DIR/restore.log"
[ -n "$done" ] || die "the copy did not finish in $TIMEOUT_MIN min (pod $POD kept until this script exits; log above)"
[ "$done" = 0 ] || { [ -n "${RESTORE_ALLOW_ERRORS:-}" ] && [ "$done" -ge 1 ] 2>/dev/null; } || die "the copy failed at: $done (restore log in $RUN_DIR/restore.log)"

tables=$(k exec "$POD" -- cat /tmp/tables)
got=$(psql_app jeffi_stores -Atc "select count(*) from pg_tables where schemaname = 'public'")
echo "   public tables: dump $tables, Azure $got"
[ "$tables" = "$got" ] || echo "   WARNING: table counts differ; check before going on" >&2
