#!/bin/bash
# The release's tenant schema set on every store tenant's own database: the desired-state fan-out, then pending
# tenant-set migration files (scripts/db-files.mjs tenant / migrations tenant). Runs in a one-off Job from the
# release's controller image (local-<sha>, pushed before the approval), so the stores' databases change in the
# database stage, before any service rolls, beside the flagship's. A tenant already at <sha> is skipped, so
# re-running is safe. --schema or --migrations runs just that half; neither = both. --dry-run renders the Job,
# has the API server validate it and runs nothing.
# Usage: bash deploy/k8s/db/40-tenant-fanout.sh <sha> [--schema|--migrations] [--dry-run]
source "$(dirname "$0")/lib.sh"
SHA=${1:?image sha of the release (its controller image local-<sha> must be in ECR)}
SCHEMA=true; FILES=true
for a in "${@:2}"; do case $a in --schema) FILES=false ;; --migrations) SCHEMA=false ;; esac; done
CALLS=; HALF=all
$SCHEMA && CALLS="tenant_schema_fanout:/api/internal/migrations/fanout"
$FILES && CALLS="$CALLS tenant_migration_files:/api/internal/migrations/files-fanout"
$SCHEMA || HALF=migrations; $FILES || HALF=schema
JOB=tenant-db-$SHA-$HALF

# In the pod: the release's controller on :3000 (load-secrets.mjs starts it, as in the Deployment), then each
# fan-out route called on it, with CRON_SECRET from the same secrets.
read -r -d '' SCRIPT <<'EOF' || true
node deploy/load-secrets.mjs &
srv=$!
n=0
until node -e "fetch('http://127.0.0.1:3000/api/health',{headers:{host:'localhost'}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; do
  n=$((n + 1)); [ $n -lt 90 ] || { echo "the release's controller did not start" >&2; exit 1; }; sleep 2
done
rc=0
for c in $FANOUT_CALLS; do
  echo "== ${c%%:*}"
  SPAWN_APP=1 APP_ENTRY=deploy/k8s-cron.mjs APP_CWD=. APP_ARGS="${c%%:*} POST ${c#*:}" CRON_TARGET=http://127.0.0.1:3000 \
    CRON_BODY="{\"gitSha\":\"$FANOUT_SHA\"}" CRON_VERBOSE=1 CRON_TIMEOUT_MS=3000000 node deploy/load-secrets.mjs || { rc=1; break; }
done
kill $srv 2>/dev/null
exit $rc
EOF
job() {
  platform_manifests "local-$SHA" | kubectl create --dry-run=client -f - -o json |
    python3 -I "$REPO/deploy/k8s/bootstrap/release-job.py" "$CTRL" "$JOB" "$SCRIPT" "FANOUT_CALLS=$CALLS" "FANOUT_SHA=$SHA"
}

k8s_tunnel
say "Store tenant databases ($HALF) from the release's controller, local-$SHA"
if $DRY_RUN; then
  echo "live controller: $(kubectl -n jeffi get deploy/$CTRL -o jsonpath='{.spec.template.spec.containers[0].image}')"
  job | kubectl create --dry-run=server -f - -o name | sed 's/$/ validated by the API server, not created/'
  echo "Dry run: would run$(for c in $CALLS; do printf ' POST %s' "${c#*:}"; done) in job/$JOB (gitSha $SHA)."
  exit 0
fi
kubectl -n jeffi delete job "$JOB" --ignore-not-found --wait=true >/dev/null
job | kubectl create -f -
# Until the pod runs (the image pull), then its log (each tenant's result), then the Job's verdict.
for _ in $(seq 1 120); do
  st=$(kubectl -n jeffi get pod -l "job-name=$JOB" -o jsonpath='{.items[0].status.phase} {.items[0].status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)
  case $st in
    Running*|Succeeded*|Failed*) break ;;
    *ErrImagePull*|*ImagePullBackOff*|*CreateContainerConfigError*|*InvalidImageName*)
      kubectl -n jeffi describe pod -l "job-name=$JOB" | tail -15 >&2
      echo "job/$JOB cannot start ($st); is local-$SHA in ECR?" >&2; exit 1 ;;
  esac
  sleep 5
done
kubectl -n jeffi logs -f "job/$JOB" || true
for _ in $(seq 1 60); do
  st=$(kubectl -n jeffi get job "$JOB" -o jsonpath='{.status.succeeded}/{.status.failed}')
  case $st in 1/*) echo "job/$JOB succeeded"; exit 0 ;; */1) break ;; esac
  sleep 5
done
echo "job/$JOB did not succeed ($st); its log is above, the Job is kept a day: kubectl -n jeffi logs job/$JOB" >&2
exit 1
