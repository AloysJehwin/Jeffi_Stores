# Shared helpers for the production DB release scripts (sourced, never run directly).
# RDS is reached through an SSH tunnel via the k3s core node (it sits in the VPC, next to RDS), as app_user
# with IAM tokens: app_user owns the app tables. rehearse.sh sets REHEARSAL=true and PG* at a local copy.
# JEFFI_CLOUD=azure (or --cloud=azure): the Azure core and the self-hosted flagship Postgres pod on it, reached
# through a kubectl port-forward over the k8s API (Tailscale), with passwords from Key Vault (deploy/azure/README.md).
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
CLOUD=${JEFFI_CLOUD:-aws}
for a in "$@"; do case $a in --cloud=*) CLOUD=${a#--cloud=} ;; esac; done
case $CLOUD in aws|azure) export JEFFI_CLOUD=$CLOUD ;; *) echo "unknown cloud: $CLOUD" >&2; exit 2 ;; esac
# Which cluster is the flagship: aws until the cutover, azure after it (CI passes the repository variable
# FLAGSHIP_CLOUD; deploy/azure/cutover/README.md). Until then Azure renders on standby (overlays/azure-standby); after
# it nothing re-applies or migrates the AWS platform, whose RDS is the pre-cutover copy. Unset: AWS as always, and
# no Azure render (say which).
FLAGSHIP_CLOUD=${FLAGSHIP_CLOUD:-}
case $FLAGSHIP_CLOUD in ''|aws|azure) ;; *) echo "unknown FLAGSHIP_CLOUD: $FLAGSHIP_CLOUD (aws or azure)" >&2; exit 2 ;; esac
refuse_if_aws_retired() {
  [ "$CLOUD" = aws ] && [ "$FLAGSHIP_CLOUD" = azure ] || return 0
  echo "$(basename "$0"): FLAGSHIP_CLOUD=azure, so the AWS platform is retired (its cluster frozen, its RDS the pre-cutover copy). Run it with JEFFI_CLOUD=azure." >&2
  exit 2
}
AZ_RG=${AZ_RG:-jeffi-prod-cin}
AZ_KEY_VAULT=${AZ_KEY_VAULT:-jeffi-prod-kv}
AZ_PG_HOST=${AZ_PG_HOST:-flagship-postgres.jeffi.svc.cluster.local} # the in-cluster host the apps use (kv-sync.sh)
AZ_PG_PORT=${AZ_PG_PORT:-15433} # local end of the port-forward: apart from the RDS tunnel's PORT, which restores hold at the same time
# Plain TCP through the port-forward: it is already inside the API server's TLS tunnel and lands on the pod's loopback
# (postgres.yaml allows only that without TLS). A TLS close can end in a reset, and kubectl drops the forward on one.
AZ_PG_SSLMODE=${AZ_PG_SSLMODE:-disable}
AZ_PG_NAMESPACE=${AZ_PG_NAMESPACE:-jeffi}
AZ_PG_SERVICE=${AZ_PG_SERVICE:-flagship-postgres}
AZ_PG_ADMIN=${AZ_PG_ADMIN:-jeffiadmin}
# The database's master login (owner of the oldest tables): RDS's postgres, the self-hosted superuser on Azure.
MASTER_ROLE=postgres; [ "$CLOUD" = azure ] && MASTER_ROLE=$AZ_PG_ADMIN
RDS_HOST=${RDS_HOST:-jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com}
RDS_INSTANCE=${RDS_INSTANCE:-jeffi-stores-db}
CORE=${CORE_HOST:-ec2-user@32.196.38.130}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/jeffi-stores-key.pem}
PORT=${TUNNEL_PORT:-15432}
REHEARSAL=${REHEARSAL:-false}
CTRL=jeffi-stores-controller-service
export AWS_REGION=${AWS_REGION:-us-east-1}
if [ "$CLOUD" = azure ]; then export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-azure.yaml}
else export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-k3s.yaml}; fi
export PGGSSENCMODE=disable  # no Kerberos attempt (a corporate krb5 realm only adds noise to auth errors)
STAMP=${STAMP:-$(date +%Y%m%d-%H%M)}
OUT_DIR=${OUT_DIR:-$HOME/Documents/db-backups/release-$STAMP}

DRY_RUN=false; YES=false
for a in "$@"; do case $a in --dry-run) DRY_RUN=true ;; --yes) YES=true ;; esac; done

say() { printf '\n== %s\n' "$*"; }
# Images are tagged by the last commit that changed what goes into them, so script/doc-only commits reuse them.
# Fixed at 8 characters: %h's length depends on the clone, and a Mac and CI must agree on the tag.
image_sha() {
  git -C "$REPO" log -1 --format=%H -- . ':(exclude)docs' ':(exclude)deploy/k8s' ':(exclude,glob)**/tests/**' \
    ':(exclude,glob)**/integration-tests/**' ':(exclude)graphify-out' ':(exclude).github' ':(exclude,glob)*.md' | cut -c1-8
}
image_tag() { echo "local-$(image_sha)"; }
confirm() {
  $YES && return 0
  read -r -p "$1 Type yes to continue: " a
  [ "$a" = yes ] || { echo "Stopped."; exit 1; }
}

# EXIT cleanup that scripts add to instead of setting their own trap (a later `trap … EXIT` would replace this one).
EXIT_HOOKS=()
on_exit() { EXIT_HOOKS+=("$1"); }
run_exit_hooks() { local h; for h in ${EXIT_HOOKS[@]+"${EXIT_HOOKS[@]}"}; do eval "$h" || true; done; }
trap run_exit_hooks EXIT

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

# SSH forward to the core; when port 22 is unreachable (a VPN's rotating exit IPs, a CI runner), the same
# forward over SSM Session Manager, which needs no inbound rule. TUNNEL=ssm skips the SSH attempt.
ssh_forward() { # <local port> <target>; replaces one of ours that holds the port but stopped forwarding (network change, sleep)
  pkill -f "ssh .*-L $1:" 2>/dev/null || true
  pkill -f "localPortNumber[^0-9]{0,6}$1([^0-9]|$)" 2>/dev/null || true; sleep 1
  [ "${TUNNEL:-auto}" = ssm ] ||
    { ssh -i "$SSH_KEY" -f -N -o ConnectTimeout=8 -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L "$1:$2" "$CORE" && return 0; }
  # A session the agent refused is usually fine a little later (it refuses while many are opening or open).
  local n; for n in 1 2 3 4 5; do ssm_forward "$1" "$2" && return 0; [ $n = 5 ] || sleep $((n * 5)); done
  [ "${TUNNEL:-auto}" = ssm ] || ssh_allowed || true
  return 1
}
# Close a session this script opened. A session left open stays on the core for 20 minutes, and enough of them
# make the agent refuse new ones ("Plugin with name Port not found"), so a failure to close one is said aloud.
# When the API call is refused, the plugin is asked to end the session itself: on SIGINT it sends the session's
# terminate flag over its own data channel, which needs no IAM permission.
close_session() {
  local err how="it stays open on the core for 20 minutes"
  err=$(aws ssm terminate-session --session-id "$1" 2>&1 >/dev/null) && return 0
  if pkill -INT -f "session-manager-plugin.*$1" 2>/dev/null; then sleep 2; how="its plugin was asked to end it instead"; fi
  echo "${GITHUB_ACTIONS:+::warning::}ssm:TerminateSession failed for $1 ($how; re-run github-oidc.sh if the deploy role lacks it): $(tr '\n' ' ' <<<"$err")" >&2
}
ssm_forward() {
  command -v session-manager-plugin >/dev/null ||
    { echo "SSH failed. To tunnel over SSM instead (no port 22) install the Session Manager plugin: brew install --cask session-manager-plugin, or on Linux the .deb from https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" >&2; return 1; }
  local id
  id=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
  echo "Forwarding :$1 over SSM ($id)" >&2
  # The remote-host document refuses 127.0.0.1; a port on the core itself has its own document.
  local doc=AWS-StartPortForwardingSessionToRemoteHost params="host=${2%:*},portNumber=${2##*:},localPortNumber=$1"
  [ "${2%:*}" = 127.0.0.1 ] && { doc=AWS-StartPortForwardingSession; params="portNumber=${2##*:},localPortNumber=$1"; }
  pkill -f "localPortNumber[^0-9]{0,6}$1([^0-9]|$)" 2>/dev/null || true
  local log pid sid=
  log=$(mktemp "${TMPDIR:-/tmp}/ssm-forward-$1.XXXXXX")
  nohup aws ssm start-session --target "$id" --document-name "$doc" --parameters "$params" >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do
    if listening "$1"; then
      sid=$(grep -o 'SessionId: [^ ]*' "$log" | head -1 | cut -d' ' -f2)
      # A CI runner is torn down without closing its sessions; left open on the core they pile up until
      # the agent stops opening new ones, so close ours when the job's script exits.
      [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$sid" ] && on_exit "close_session $sid"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break # the session ended without opening the port: no point waiting out the minute
    sleep 1
  done
  echo "SSM forward on :$1 didn't open:" >&2
  sed 's/^/  /' "$log" >&2
  sid=$(grep -o 'SessionId: [^ ]*' "$log" | head -1 | cut -d' ' -f2)
  [ -n "$sid" ] && aws ssm terminate-session --session-id "$sid" >/dev/null 2>&1 || true
  return 1
}
pg_up() { pg_isready -h 127.0.0.1 -p "$PORT" -t 10 -q 2>/dev/null; }

# Azure: a Key Vault value, for command substitution only (never echo it).
kv_secret() { az keyvault secret show --vault-name "$AZ_KEY_VAULT" --name "$1" --query value -o tsv; }
# app_user's and the admin's passwords in a 0600 PGPASSFILE (libpq, psql and migra read it), removed on exit:
# no password in argv or the environment. Children of this script reuse it.
az_pgpass() {
  [ -n "${PGPASSFILE:-}" ] && [ -s "$PGPASSFILE" ] && return 0
  local d app admin
  d=$(mktemp -d); chmod 700 "$d"; on_exit "rm -rf '$d'"
  esc() { sed 's/[\\:]/\\&/g'; }
  app=$(kv_secret pg-app-password 2>/dev/null | esc || true)
  admin=$(kv_secret pg-admin-password | esc)
  [ -n "$admin" ] || { echo "pg-admin-password is not readable in $AZ_KEY_VAULT" >&2; exit 1; }
  (umask 077; { [ -z "$app" ] || printf '*:*:*:app_user:%s\n' "$app"; printf '*:*:*:%s:%s\n' "$AZ_PG_ADMIN" "$admin"; } > "$d/pgpass")
  export PGPASSFILE=$d/pgpass
}
# kubectl port-forward to the flagship Postgres Service (reuses one already answering on AZ_PG_PORT); the scripts
# connect to 127.0.0.1:$AZ_PG_PORT. Needs only the k8s API (KUBECONFIG), no subnet route or private DNS.
az_db() {
  export PG_ADDR=127.0.0.1
  az_pgpass
  if ! { listening "$AZ_PG_PORT" && pg_isready -h 127.0.0.1 -p "$AZ_PG_PORT" -t 5 -q 2>/dev/null; }; then
    local log pf
    log=$(mktemp "${TMPDIR:-/tmp}/pg-forward.XXXXXX"); on_exit "rm -f '$log'"
    kubectl -n "$AZ_PG_NAMESPACE" port-forward "svc/$AZ_PG_SERVICE" "$AZ_PG_PORT:5432" >"$log" 2>&1 &
    pf=$!; on_exit "kill $pf 2>/dev/null"
    for _ in $(seq 1 15); do
      pg_isready -h 127.0.0.1 -p "$AZ_PG_PORT" -t 5 -q 2>/dev/null && return 0
      kill -0 "$pf" 2>/dev/null || break
      sleep 2
    done
    echo "$AZ_PG_SERVICE does not answer through kubectl port-forward on :$AZ_PG_PORT (KUBECONFIG=$KUBECONFIG; is the pod Ready: kubectl -n $AZ_PG_NAMESPACE get pod flagship-postgres-0?):" >&2
    sed 's/^/  /' "$log" >&2
    exit 1
  fi
}

tunnel() {
  $REHEARSAL && return 0
  if [ "$CLOUD" = azure ]; then az_db; return 0; fi
  if listening "$PORT"; then for _ in 1 2 3; do pg_up && return 0; sleep 2; done; fi
  ssh_forward "$PORT" "$RDS_HOST:5432"
  for _ in $(seq 1 15); do pg_up && return 0; sleep 1; done
  echo "Could not open the tunnel to $RDS_HOST through $CORE" >&2; exit 1
}

# libpq env for app_user (a fresh IAM token per call; they expire after 15 minutes) and for the master user postgres.
pg_env() {
  if $REHEARSAL; then export PGUSER=app_user PGPASSWORD=$REHEARSAL_PW; return 0; fi
  if [ "$CLOUD" = azure ]; then export PGHOST=${PG_ADDR:?tunnel first} PGPORT=$AZ_PG_PORT PGUSER=app_user PGSSLMODE=$AZ_PG_SSLMODE; return 0; fi
  export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=app_user PGSSLMODE=require
  PGPASSWORD=$(aws rds generate-db-auth-token --hostname "$RDS_HOST" --port 5432 --username app_user)
  export PGPASSWORD
}
pg_master_env() {
  if $REHEARSAL; then export PGUSER=postgres PGPASSWORD=$REHEARSAL_PW; return 0; fi
  if [ "$CLOUD" = azure ]; then export PGHOST=${PG_ADDR:?tunnel first} PGPORT=$AZ_PG_PORT PGUSER=$AZ_PG_ADMIN PGSSLMODE=$AZ_PG_SSLMODE; return 0; fi
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
  elif [ "$CLOUD" = azure ]; then # the password comes from PGPASSFILE
    RDS_DB=$db TARGET_URL="postgresql://app_user@${PG_ADDR:?tunnel first}:$AZ_PG_PORT/$db?sslmode=$AZ_PG_SSLMODE" SCHEMA_DIFF_OUT=$OUT_DIR \
      bash "$REPO/deploy/schema-diff.sh" "$@"
  else
    RDS_HOST=$RDS_HOST RDS_PORT=5432 RDS_CONNECT_HOST=127.0.0.1 RDS_CONNECT_PORT=$PORT RDS_USER=app_user RDS_DB=$db \
      SCHEMA_DIFF_OUT=$OUT_DIR bash "$REPO/deploy/schema-diff.sh" "$@"
  fi
}

# The platform manifests with every jeffi-stores-* image at <tag> (rollout.sh, and 40-tenant-fanout.sh's Job).
# On Azure, the overlay (cluster identity for AWS and Key Vault, the AWS tenant edge); it refuses to render while a
# placeholder is left in it (deploy/k8s/overlays/azure/kustomization.yaml). Before the cutover (FLAGSHIP_CLOUD=aws),
# azure-standby: the app CronJobs suspended, messaging, documents and voice at 0.
platform_manifests() {
  local dir=$REPO/deploy/k8s/platform out
  if [ "$CLOUD" = azure ]; then
    case $FLAGSHIP_CLOUD in
      azure) dir=$REPO/deploy/k8s/overlays/azure ;;
      aws) dir=$REPO/deploy/k8s/overlays/azure-standby ;;
      *) echo "Set FLAGSHIP_CLOUD to render the Azure platform: aws before the cutover (standby: CronJobs suspended, messaging, documents and voice at 0), azure after it" >&2; return 1 ;;
    esac
  fi
  out=$(kubectl kustomize "$dir")
  if grep -q 'REPLACE_ME' <<<"$out"; then echo "$dir still has REPLACE_ME placeholders" >&2; return 1; fi
  sed -E "s#(708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:$1#g" <<<"$out"
}

k8s_up() { kubectl get nodes --request-timeout=10s >/dev/null 2>&1; }
k8s_tunnel() {
  if [ "$CLOUD" = azure ]; then # the kubeconfig's server is the core's Tailscale address (the Postgres port-forward rides on it)
    for _ in 1 2 3; do k8s_up && return 0; sleep 3; done
    echo "The Azure cluster does not answer over Tailscale (KUBECONFIG=$KUBECONFIG)" >&2; exit 1
  fi
  if listening 16443; then for _ in 1 2 3; do k8s_up && return 0; sleep 2; done; fi
  ssh_forward 16443 127.0.0.1:6443 || { echo "Could not open a tunnel to the cluster through $CORE" >&2; exit 1; }
  for _ in $(seq 1 10); do k8s_up && return 0; sleep 2; done
  echo "Tunnel is up but the cluster does not answer (KUBECONFIG=$KUBECONFIG)" >&2; exit 1
}
# POST an internal route from inside the controller pod; CRON_SECRET goes over stdin, never into argv.
in_cluster() {
  local job=$1 path=$2 body=${3:-}
  kubectl -n jeffi get secret cron-secret -o jsonpath='{.data.CRON_SECRET}' | base64 -d |
    kubectl -n jeffi exec -i deploy/$CTRL -- env CRON_BODY="$body" CRON_VERBOSE=1 CRON_TIMEOUT_MS=900000 \
      sh -c "read -r CRON_SECRET; export CRON_SECRET; exec node deploy/k8s-cron.mjs $job POST $path"
}
