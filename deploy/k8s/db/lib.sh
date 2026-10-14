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
export PGGSSENCMODE=disable  # no Kerberos attempt (a corporate krb5 realm only adds noise to auth errors)
STAMP=${STAMP:-$(date +%Y%m%d-%H%M)}
OUT_DIR=${OUT_DIR:-$HOME/Documents/db-backups/release-$STAMP}

DRY_RUN=false; YES=false
for a in "$@"; do case $a in --dry-run) DRY_RUN=true ;; --yes) YES=true ;; esac; done

say() { printf '\n== %s\n' "$*"; }
# Images are tagged by the last commit that changed what goes into them, so script/doc-only commits reuse them.
image_sha() {
  git -C "$REPO" log -1 --format=%h -- . ':(exclude)docs' ':(exclude)deploy/k8s' ':(exclude)tests' \
    ':(exclude)integration-tests' ':(exclude)graphify-out' ':(exclude).github' ':(exclude,glob)*.md'
}
confirm() {
  $YES && return 0
  read -r -p "$1 Type yes to continue: " a
  [ "$a" = yes ] || { echo "Stopped."; exit 1; }
}

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
CORE_IP=${CORE#*@}
# The core's security group allows SSH from listed IPs only; a home IP changes now and then.
ssh_allowed() {
  local ip sg cidrs
  ip=$(curl -s --max-time 10 https://checkip.amazonaws.com)
  sg=$(aws ec2 describe-instances --filters "Name=ip-address,Values=$CORE_IP" \
    --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
  cidrs=$(aws ec2 describe-security-groups --group-ids "$sg" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text | tr '\t' ' ')
  python3 -I -c 'import ipaddress, sys; ip = ipaddress.ip_address(sys.argv[1])
sys.exit(0 if any(ip in ipaddress.ip_network(c) for c in sys.argv[2:]) else 1)' "$ip" $cidrs && return 0
  echo "SSH to the core is allowed only from $cidrs, and your IP is $ip. Allow it, then re-run:" >&2
  echo "  aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port 22 --cidr $ip/32" >&2
  return 1
}

# SSH forward to the core; when port 22 is unreachable (a VPN's rotating exit IPs), the same forward over
# SSM Session Manager, which needs no inbound rule.
ssh_forward() { # <local port> <target>; replaces one of ours that holds the port but stopped forwarding (network change, sleep)
  pkill -f "ssh .*-L $1:" 2>/dev/null || true
  pkill -f "localPortNumber[^0-9]{0,6}$1([^0-9]|$)" 2>/dev/null || true; sleep 1
  ssh -i "$SSH_KEY" -f -N -o ConnectTimeout=8 -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L "$1:$2" "$CORE" && return 0
  ssm_forward "$1" "$2" && return 0
  ssh_allowed || true
  return 1
}
ssm_forward() {
  command -v session-manager-plugin >/dev/null ||
    { echo "SSH failed. To tunnel over SSM instead (no port 22): brew install --cask session-manager-plugin" >&2; return 1; }
  local id
  id=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
  echo "SSH failed; forwarding :$1 over SSM ($id)" >&2
  # The remote-host document refuses 127.0.0.1; a port on the core itself has its own document.
  local doc=AWS-StartPortForwardingSessionToRemoteHost params="host=${2%:*},portNumber=${2##*:},localPortNumber=$1"
  [ "${2%:*}" = 127.0.0.1 ] && { doc=AWS-StartPortForwardingSession; params="portNumber=${2##*:},localPortNumber=$1"; }
  nohup aws ssm start-session --target "$id" --document-name "$doc" --parameters "$params" >/dev/null 2>&1 &
  for _ in $(seq 1 20); do listening "$1" && return 0; sleep 1; done
  return 1
}
pg_up() { pg_isready -h 127.0.0.1 -p "$PORT" -t 10 -q 2>/dev/null; }
tunnel() {
  $REHEARSAL && return 0
  if listening "$PORT"; then for _ in 1 2 3; do pg_up && return 0; sleep 2; done; fi
  ssh_forward "$PORT" "$RDS_HOST:5432"
  for _ in $(seq 1 15); do pg_up && return 0; sleep 1; done
  echo "Could not open the tunnel to $RDS_HOST through $CORE" >&2; exit 1
}

# libpq env for app_user (a fresh IAM token per call; they expire after 15 minutes) and for the master user postgres.
pg_env() {
  if $REHEARSAL; then export PGUSER=app_user PGPASSWORD=$REHEARSAL_PW; return 0; fi
  export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=app_user PGSSLMODE=require
  PGPASSWORD=$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port 5432 --username app_user)
  export PGPASSWORD
}
pg_master_env() {
  if $REHEARSAL; then export PGUSER=postgres PGPASSWORD=$REHEARSAL_PW; return 0; fi
  export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGSSLMODE=require
  PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id jeffi/production --query SecretString --output text |
    python3 -I -c 'import json, sys; print(json.load(sys.stdin)["RDS_MASTER_PASSWORD"])')
  export PGPASSWORD
}
psql_app() { local db=$1; shift; (pg_env; psql -d "$db" -v ON_ERROR_STOP=1 "$@"); }
psql_master() { local db=$1; shift; (pg_master_env; psql -d "$db" -v ON_ERROR_STOP=1 "$@"); }
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
    RDS_DB=$db TARGET_URL="postgresql://app_user:$REHEARSAL_PW@127.0.0.1:$PGPORT/$db" SCHEMA_DIFF_OUT=$OUT_DIR \
      bash "$REPO/deploy/schema-diff.sh" "$@"
  else
    RDS_HOST=$RDS_HOST RDS_PORT=5432 RDS_CONNECT_HOST=127.0.0.1 RDS_CONNECT_PORT=$PORT RDS_USER=app_user RDS_DB=$db \
      SCHEMA_DIFF_OUT=$OUT_DIR bash "$REPO/deploy/schema-diff.sh" "$@"
  fi
}

k8s_up() { kubectl get nodes --request-timeout=10s >/dev/null 2>&1; }
k8s_tunnel() {
  if listening 16443; then for _ in 1 2 3; do k8s_up && return 0; sleep 2; done; fi
  ssh_forward 16443 127.0.0.1:6443
  for _ in $(seq 1 10); do k8s_up && return 0; sleep 2; done
  echo "Could not reach the cluster through $CORE" >&2; exit 1
}
# POST an internal route from inside the controller pod; CRON_SECRET goes over stdin, never into argv.
in_cluster() {
  local job=$1 path=$2 body=${3:-}
  kubectl -n jeffi get secret cron-secret -o jsonpath='{.data.CRON_SECRET}' | base64 -d |
    kubectl -n jeffi exec -i deploy/$CTRL -- env CRON_BODY="$body" CRON_VERBOSE=1 CRON_TIMEOUT_MS=900000 \
      sh -c "read -r CRON_SECRET; export CRON_SECRET; exec node deploy/k8s-cron.mjs $job POST $path"
}
