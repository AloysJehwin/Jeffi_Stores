# Shared by cutover.sh and rollback.sh (sourced, never run directly). See README.md.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
SELF=$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)/$(basename "${BASH_SOURCE[1]}")
BOOT=$REPO/deploy/k8s/bootstrap
DBLIB=$REPO/deploy/k8s/db/lib.sh
R53=$REPO/deploy/aws/edge/route53-plan.sh
BACKUPS=${BACKUPS_DIR:-$HOME/Documents/db-backups}
# Fixed once per window: export CUTOVER_DATE at T-0 so a run that crosses midnight keeps one folder and log.
DATE=${CUTOVER_DATE:-$(date +%Y%m%d)}
RUN_DIR=$BACKUPS/cutover-$DATE
LOG=$BACKUPS/cutover-$DATE.log
AWS_KUBECONFIG=${AWS_KUBECONFIG:-$HOME/.kube/jeffi-k3s.yaml}
AZ_KUBECONFIG=${AZ_KUBECONFIG:-$HOME/.kube/jeffi-azure.yaml}
AWS_FREEZE_STATE=$BACKUPS/freeze-state.txt
AZ_FREEZE_STATE=$RUN_DIR/azure-freeze-state.txt
SITE_DIST=${SITE_DIST:-E1M6ZFCWXAMF26}
MOBILE_HOST=mobile.jeffistores.in
ORIGIN_HOST=origin.jeffistores.in
# The platform's Anthropic identity (platform row of ai_provider_identities).
ANTH_TENANT=00000000-0000-0000-0000-000000000000
ANTH_SA=svac_01HXWF7V5MmqFNXzAaxbofaH
ANTH_RULE_AZURE=fdrl_01QsmDKrzxm6y34Ho52LNwk5

SCRATCH=$(mktemp -d); chmod 700 "$SCRATCH"; trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$BACKUPS" 2>/dev/null || true

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
mode() { if $APPLY; then echo APPLY; else echo DRY; fi; }
logf() { printf '%s [%s] %s\n' "$(ts)" "$(mode)" "$*" >> "$LOG" 2>/dev/null || true; }
say() { printf '\n== %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
need() { local c; for c in "$@"; do command -v "$c" >/dev/null || die "missing tool: $c"; done; }

# Typed confirmation before an irreversible step: the step's name, not a bare yes. Never skipped, no --yes.
confirm_typed() { # <word> <what happens>
  [ -t 0 ] || die "needs a terminal for the typed confirmation"
  echo "About to: $2"
  local a; read -r -p "Type '$1' to continue: " a
  [ "$a" = "$1" ] || die "not confirmed, stopped"
}

# Run lib.sh helpers (tunnel, psql_app, pg_docker, ...) against one cloud in a fresh shell: the AWS dump and the Azure
# restore need different JEFFI_CLOUDs and lib.sh fixes it at load time. Callers export what <code> reads.
lib_run() { # <aws|azure> <code>
  JEFFI_CLOUD=$1 OUT_DIR=$RUN_DIR bash -c 'set -euo pipefail; source "$0"; '"$2" "$DBLIB"
}
image_sha() { bash -c 'source "$0"; image_sha' "$DBLIB"; }

# freeze.sh against one cluster, with its own state file so the AWS and Azure freezes never collide.
freeze_aws() { KUBECONFIG=$AWS_KUBECONFIG FREEZE_STATE=$AWS_FREEZE_STATE bash "$BOOT/freeze.sh" "$1"; }
freeze_azure() { KUBECONFIG=$AZ_KUBECONFIG FREEZE_STATE=$AZ_FREEZE_STATE bash "$BOOT/freeze.sh" "$1"; }
aws_tunnel() { KUBECONFIG=$AWS_KUBECONFIG lib_run aws 'k8s_tunnel'; }

cf_id_for_alias() {
  aws cloudfront list-distributions --output json | python3 -I -c 'import json,sys; h=sys.argv[1]
d=json.load(sys.stdin)["DistributionList"].get("Items") or []
print(next((x["Id"] for x in d if h in ((x.get("Aliases") or {}).get("Items") or [])), ""))' "$1"
}
# Repoint every custom origin of a distribution to $2 (S3 origins, the maintenance page, are left alone). The first apply
# saves the untouched config as cloudfront-before-<id>.json, which rollback.sh restores.
cf_repoint() { # <dist id> <origin host>
  local id=$1 origin=$2 cur=$SCRATCH/cf-$1.json etag rc=0
  aws cloudfront get-distribution-config --id "$id" --output json > "$cur"
  python3 -I - "$cur" "$origin" "$SCRATCH/cf-$id-new.json" <<'PY' || rc=$?
import json, sys
cur, origin, out = sys.argv[1:]
c = json.load(open(cur))["DistributionConfig"]; n = 0
for o in c["Origins"]["Items"]:
    if "CustomOriginConfig" not in o: continue
    hdrs = [h["HeaderName"] for h in (o.get("CustomHeaders") or {}).get("Items") or []]
    print(f"   origin {o['Id']}: {o['DomainName']} -> {origin}" + (f" (keeps header(s) {', '.join(hdrs)})" if hdrs else ""))
    if o["DomainName"] != origin: o["DomainName"] = origin; n += 1
json.dump(c, open(out, "w"))
sys.exit(0 if n else 3)
PY
  [ $rc != 3 ] || { echo "   $id already points at $origin"; return 0; }
  [ $rc = 0 ] || die "could not rewrite the config of $id"
  $APPLY || { echo "   (dry run: $id unchanged)"; return 0; }
  [ -s "$RUN_DIR/cloudfront-before-$id.json" ] || { cp "$cur" "$RUN_DIR/cloudfront-before-$id.json"; chmod 600 "$RUN_DIR/cloudfront-before-$id.json"; }
  etag=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$cur")
  aws cloudfront update-distribution --id "$id" --if-match "$etag" --distribution-config "file://$SCRATCH/cf-$id-new.json" \
    --query 'Distribution.Status' --output text >/dev/null
  echo "   $id updated; waiting for Deployed (can take 5-15 minutes)"
  aws cloudfront wait distribution-deployed --id "$id"
}

# Driver: STEPS and step_<name> (dashes as underscores) come from the caller. A step runs in its own bash so `set -e`
# holds inside it (errexit is ignored in anything called from an if or ||).
usage() { sed -n '2,/^set -euo/p' "$SELF" | sed '$d; s/^# \{0,1\}//'; }
main() {
  APPLY=${CUTOVER_APPLY:-false}; STORES_ONLY=${STORES_ONLY:-}
  if [ "${1:-}" = __step ]; then "step_${2//-/_}"; exit 0; fi
  local only='' from='' s run=() on=false
  while [ $# -gt 0 ]; do case $1 in
    --apply) APPLY=true ;;
    --step) only=${2:?--step <name>}; shift ;;
    --from) from=${2:?--from <name>}; shift ;;
    --only) STORES_ONLY=${2:?--only <store slug | pool>}; shift ;;
    --list) printf '%s\n' "${STEPS[@]}"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument $1 (--help)" ;;
  esac; shift; done
  [ -z "$only" ] || [ -z "$from" ] || die "--step and --from are exclusive"
  for s in $only $from; do printf '%s\n' "${STEPS[@]}" | grep -qx "$s" || die "unknown step $s (--list)"; done
  for s in "${STEPS[@]}"; do
    if [ -n "$only" ]; then
      if [ "$s" = "$only" ]; then run+=("$s"); fi
    elif [ -n "$from" ]; then
      if [ "$s" = "$from" ]; then on=true; fi
      if $on; then run+=("$s"); fi
    else run+=("$s"); fi
  done
  mkdir -p "$RUN_DIR"
  export CUTOVER_APPLY=$APPLY CUTOVER_DATE=$DATE STORES_ONLY=${STORES_ONLY:-}
  echo "$(basename "$SELF"): $(mode) run, steps: ${run[*]}. Log: $LOG"
  if ! $APPLY; then echo "Dry run: reads only. Nothing changes without --apply."; fi
  local t0 rc
  for s in "${run[@]}"; do
    say "$s"; logf "$s start"; t0=$(date +%s); rc=0
    bash "$SELF" __step "$s" || rc=$?
    if [ $rc != 0 ]; then
      logf "$s FAILED (exit $rc, $(($(date +%s) - t0))s)"; echo "Stopped at $s. Fix it, then re-run with --from $s." >&2; exit 1
    fi
    logf "$s ok ($(($(date +%s) - t0))s)"
    if $APPLY; then echo "$s $(ts)" >> "$RUN_DIR/done.txt"; fi
  done
  echo; echo "Done. Log: $LOG"
}
