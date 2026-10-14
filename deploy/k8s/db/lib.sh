# Shared helpers for the production DB release scripts (sourced, never run directly).
# RDS is reached through an SSH tunnel via the k3s core node (it sits in the VPC, next to RDS), as app_user
# with IAM tokens: app_user owns the app tables. rehearse.sh sets REHEARSAL=true and PG* at a local copy.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
RDS_HOST=${RDS_HOST:-jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com}
RDS_INSTANCE=${RDS_INSTANCE:-jeffi-stores-db}
CORE=${CORE_HOST:-ec2-user@32.196.38.130}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/jeffi-stores-key.pem}
PORT=${TUNNEL_PORT:-15432}
REHEARSAL=${REHEARSAL:-false}
CTRL=jeffi-stores-controller-service
export AWS_REGION=${AWS_REGION:-us-east-1}
export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-k3s.yaml}
STAMP=${STAMP:-$(date +%Y%m%d-%H%M)}
OUT_DIR=${OUT_DIR:-$HOME/Documents/db-backups/release-$STAMP}

DRY_RUN=false; YES=false
for a in "$@"; do case $a in --dry-run) DRY_RUN=true ;; --yes) YES=true ;; esac; done

say() { printf '\n== %s\n' "$*"; }
confirm() {
  $YES && return 0
  read -r -p "$1 Type yes to continue: " a
  [ "$a" = yes ] || { echo "Stopped."; exit 1; }
}

tunnel() {
  $REHEARSAL && return 0
  pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null && return 0
  ssh -i "$SSH_KEY" -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L "$PORT:$RDS_HOST:5432" "$CORE"
  for _ in $(seq 1 15); do pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null && return 0; sleep 1; done
  echo "Could not open the tunnel to $RDS_HOST through $CORE" >&2; exit 1
}

# libpq env for app_user; a fresh IAM token per call (they expire after 15 minutes).
pg_env() {
  $REHEARSAL && return 0
  export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=app_user PGSSLMODE=require
  PGPASSWORD=$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port 5432 --username app_user)
  export PGPASSWORD
}
psql_app() { local db=$1; shift; (pg_env; psql -d "$db" -v ON_ERROR_STOP=1 "$@"); }
pg_major() { psql_app jeffi_stores -Atc "show server_version_num" | cut -c1-2; }
# pg_dump/pg_restore matching the server's major version (the local client may be older).
pg_docker() {
  local image="postgres:$(pg_major)-alpine"
  mkdir -p "$OUT_DIR"
  (pg_env; docker run --rm -i -e PGHOST=host.docker.internal -e PGPORT -e PGUSER -e PGPASSWORD -e PGSSLMODE \
    -v "$OUT_DIR:/out" "$image" "$@")
}

# schema-diff.sh against <db> (the IAM token stays signed for the real endpoint, the connection uses the tunnel).
schema_diff() {
  local db=$1; shift
  if $REHEARSAL; then
    RDS_DB=$db TARGET_URL="postgresql://$PGUSER:$PGPASSWORD@127.0.0.1:$PGPORT/$db" SCHEMA_DIFF_OUT=$OUT_DIR \
      bash "$REPO/deploy/schema-diff.sh" "$@"
  else
    RDS_HOST=$RDS_HOST RDS_PORT=5432 RDS_CONNECT_HOST=127.0.0.1 RDS_CONNECT_PORT=$PORT RDS_USER=app_user RDS_DB=$db \
      SCHEMA_DIFF_OUT=$OUT_DIR bash "$REPO/deploy/schema-diff.sh" "$@"
  fi
}

k8s_tunnel() {
  kubectl get nodes >/dev/null 2>&1 && return 0
  ssh -i "$SSH_KEY" -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 16443:127.0.0.1:6443 "$CORE"
  kubectl get nodes >/dev/null
}
# POST an internal route from inside the controller pod; CRON_SECRET goes over stdin, never into argv.
in_cluster() {
  local job=$1 path=$2 body=${3:-}
  kubectl -n jeffi get secret cron-secret -o jsonpath='{.data.CRON_SECRET}' | base64 -d |
    kubectl -n jeffi exec -i deploy/$CTRL -- env CRON_BODY="$body" CRON_VERBOSE=1 CRON_TIMEOUT_MS=900000 \
      sh -c "read -r CRON_SECRET; export CRON_SECRET; exec node deploy/k8s-cron.mjs $job POST $path"
}
