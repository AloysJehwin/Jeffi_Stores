#!/bin/bash
# The whole go-live (docs/GO_LIVE_RUNBOOK.md) in one run. With the site up: preflight, build + push the images,
# rehearse the DB steps on a fresh dump. Then one confirmation and the window: freeze, backup, core resize,
# schema, control-plane merge, secrets, release, seeds, document-host DNS, pool capacity, verify, unfreeze.
# Stops at the first failure (site still frozen) and prints how to resume or roll back.
# Usage: bash deploy/k8s/go-live.sh [--dry-run] [--skip-rehearsal] [--from <step>]
#   --dry-run  read-only previews of every step (no build, no writes)
[ -n "${OUT_DIR:-}" ] || OUT_DIR=$HOME/Documents/db-backups/go-live-$(date +%Y%m%d-%H%M)
source "$(dirname "$0")/db/lib.sh"
FROM=1; REHEARSE=true
while [ $# -gt 0 ]; do case $1 in --from) FROM=${2:?step}; shift ;; --skip-rehearsal) REHEARSE=false ;; esac; shift; done
case $FROM in [1-9]|1[0-2]) ;; *) echo "--from takes 1-12" >&2; exit 1 ;; esac
export STAMP OUT_DIR
CORE_TYPE=${CORE_TYPE:-r7g.medium}
CORE_IP=${CORE#*@}
DB=$REPO/deploy/k8s/db; BOOT=$REPO/deploy/k8s/bootstrap
mkdir -p "$OUT_DIR"; exec > >(tee -a "$OUT_DIR/go-live.log") 2>&1
flag() { if $DRY_RUN; then echo --dry-run; else echo --yes; fi; }
would() { echo "(dry run) would: $*"; }

preflight() {
  [ -z "$(git -C "$REPO" status --porcelain -- controller-service messaging-service document-service public-api-service packages deploy database package.json package-lock.json vendor)" ] ||
    { echo "Uncommitted changes: commit first." >&2; return 1; }
  echo "commit $(git -C "$REPO" rev-parse --short HEAD), AWS $(aws sts get-caller-identity --query Arn --output text)"
  [ -f "$SSH_KEY" ] || { echo "Missing $SSH_KEY" >&2; return 1; }
  docker info >/dev/null 2>&1 || { echo "Docker Desktop is not running." >&2; return 1; }
  ssh_allowed
  k8s_tunnel; kubectl get nodes
  tunnel; psql_app jeffi_stores -Atc "SELECT 'jeffi_stores reachable as ' || current_user"
  echo "EventBridge schedules (none may stop RDS or the core node in the next two hours):"
  aws scheduler list-schedules --query 'Schedules[].[Name,State]' --output text 2>/dev/null || echo "  (could not list)"
}

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

# The account's EC2 limit is 1 vCPU (raised only once the AWS bill is settled); a type over it never starts.
resize_core() {
  local id type state need limit
  id=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
  read -r type state < <(aws ec2 describe-instances --instance-ids "$id" \
    --query 'Reservations[0].Instances[0].[InstanceType,State.Name]' --output text)
  echo "core $id is $type ($state)"
  if [ "$type" != "$CORE_TYPE" ] || [ "$state" != running ]; then
    need=$(aws ec2 describe-instance-types --instance-types "$CORE_TYPE" --query 'InstanceTypes[0].VCpuInfo.DefaultVCpus' --output text)
    limit=$(aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --query Quota.Value --output text)
    [ "$need" -le "${limit%.*}" ] || { echo "$CORE_TYPE has $need vCPUs, over the account's limit of $limit; the core was not touched." >&2; return 1; }
    if $DRY_RUN; then would "set the core to $CORE_TYPE and start it"; return 0; fi
    if [ "$type" != "$CORE_TYPE" ]; then
      aws ec2 stop-instances --instance-ids "$id" >/dev/null
      aws ec2 wait instance-stopped --instance-ids "$id"
      aws ec2 modify-instance-attribute --instance-id "$id" --instance-type "{\"Value\":\"$CORE_TYPE\"}"
    fi
    aws ec2 start-instances --instance-ids "$id" >/dev/null
    aws ec2 wait instance-status-ok --instance-ids "$id"
    pkill -f "ssh .*-L $PORT:" || true
  fi
  if $DRY_RUN; then return 0; fi
  for _ in $(seq 1 60); do k8s_up && break; ssh_forward 16443 127.0.0.1:6443 || true; sleep 10; done
  kubectl wait --for=condition=Ready node -l node-role.kubernetes.io/control-plane --timeout=600s
  for ns in kube-system cert-manager; do
    for d in $(kubectl -n $ns get deploy -o name); do kubectl -n $ns rollout status "$d" --timeout=600s; done
  done
}

s1() { if $DRY_RUN; then would "freeze.sh on"; else bash "$BOOT/freeze.sh" on; fi; }
s2() { bash "$DB/00-backup.sh" "$(flag)"; }
s3() { resize_core; }
s4() { bash "$DB/10-platform-schema.sh" "$(flag)"; }
s5() { bash "$DB/20-merge-control-plane.sh" "$(flag)"; }
s6() { bash "$DB/30-secrets.sh" "$(flag)"; }
s7() { if $DRY_RUN; then would "release.sh (platform, tenant fan-out, stores, smoke test)"; else bash "$BOOT/release.sh"; fi; }
s8() { if $DRY_RUN; then would "50-seeds.sh"; else bash "$DB/50-seeds.sh"; fi; }
s9() {
  if $DRY_RUN; then bash "$BOOT/doc-hosts-dns.sh"; return 0; fi
  bash "$BOOT/doc-hosts-dns.sh" --apply
  curl -fsS --max-time 15 --resolve "invoice.jeffistores.in:443:$CORE_IP" https://invoice.jeffistores.in/healthz; echo
}
# Dedicated pool nodes only: the core keeps its own capacity (it also runs the platform).
POOL_NODES='jeffi.io/pool=basic,!node-role.kubernetes.io/control-plane'
s10() {
  if [ -z "$(kubectl get nodes -l "$POOL_NODES" -o name)" ]; then echo "no dedicated Basic pool nodes; nothing to relabel"; return 0; fi
  if $DRY_RUN; then kubectl get nodes -l "$POOL_NODES" -L jeffi.io/pool-capacity; return 0; fi
  kubectl label node -l "$POOL_NODES" jeffi.io/pool-capacity=4 --overwrite
}
s11() { if $DRY_RUN; then would "verify.sql"; else tunnel; psql_app jeffi_stores -f "$DB/verify.sql"; fi; }
s12() { if $DRY_RUN; then would "freeze.sh off"; else bash "$BOOT/freeze.sh" off; fi; }

TITLES=("" "Freeze writes" "Backup" "Core node → $CORE_TYPE" "Schema" "Control-plane merge" "Secrets and bucket"
  "Release" "Seeds" "Document-host DNS" "Pool capacity" "Verify" "Unfreeze")
HINTS=(""
  "Nothing has changed. bash deploy/k8s/bootstrap/freeze.sh off brings the site back."
  "Nothing has changed in the DB. bash deploy/k8s/bootstrap/freeze.sh off brings the site back."
  "The DB is untouched. Resuming this step starts a stopped core (within the vCPU limit); or start it and unfreeze."
  "The diff runs in one transaction, so nothing applied if it failed there; manual.sql is idempotent."
  "The row copy is one transaction. If the tables exist but the copy failed, drop them from jeffi_stores first."
  "bash $OUT_DIR/secrets-rollback.sh restores the previous secret versions."
  "See docs/GO_LIVE_RUNBOOK.md, Rollback, step 7."
  "The site is up; this only seeds templates."
  "Rollback: the change batch in $OUT_DIR/rollback.json."
  "The site is up."
  "The site is up."
  "The site is up; the CronJobs are still suspended.")

CUR=0; PRE=false
trap 'rc=$?; if [ $rc -ne 0 ] && $PRE; then
  echo "Stopped before the window: nothing in production changed. Fix it and re-run (pushed images are reused)." >&2
elif [ $rc -ne 0 ] && [ $CUR -gt 0 ]; then
  echo "Step $CUR (${TITLES[$CUR]}) failed. ${HINTS[$CUR]}" >&2
  echo "Fix it, then resume: OUT_DIR=$OUT_DIR bash deploy/k8s/go-live.sh --from $CUR" >&2; fi' EXIT

say "Preflight"
preflight
if [ "$FROM" = 1 ] && ! $DRY_RUN; then
  PRE=true
  say "Images (site up)"
  bash "$BOOT/release.sh" --build-only
  if $REHEARSE; then
    say "Rehearsal on a fresh dump (site up)"
    OUT_DIR=$OUT_DIR/rehearsal bash "$DB/00-backup.sh" --yes --dumps-only
    bash "$DB/rehearse.sh" "$OUT_DIR/rehearsal"
    docker rm -f jeffi-rehearsal >/dev/null 2>&1 || true
  fi
fi
if ! $DRY_RUN; then
  echo
  read -r -p "Ready. This takes the site down (60-90 min) and runs steps $FROM-12. Type go-live to start: " a
  [ "$a" = go-live ] || { echo "Stopped before the window; nothing changed."; exit 1; }
fi
PRE=false
for n in $(seq "$FROM" 12); do
  CUR=$n
  say "Step $n/12: ${TITLES[$n]}"
  "s$n"
done
CUR=0
if $DRY_RUN; then echo "Dry run complete; nothing changed."; exit 0; fi
say "Live: images local-$(image_sha), HEAD $(git -C "$REPO" rev-parse --short HEAD)"
echo "Check by hand: admin sign-in, a checkout, an invoice page, a test email and SMS. Log and files: $OUT_DIR"
