#!/bin/bash
# Roll a release, in phases (ci.yml runs each as its own job; no phase = all three, in order):
#   platform   the platform (controller, messaging, document, public-api and mobile services, CronJobs)
#   tenant-db  the schema and migration files fanned out to every store tenant's database (40-tenant-fanout.sh);
#              tenant-schema / tenant-migrations run just one half (the pipeline's separate stages)
#   stores     every store: the controller re-applies its namespace at the release images (its controller,
#              messaging and document pods) and we wait for them, stopping at the first failure
# --dry-run changes nothing: platform shows `kubectl diff`, tenant-db what it would post, stores what it would wait on.
# Usage: rollout.sh <tag> [platform|tenant-db|tenant-schema|tenant-migrations|stores] [--dry-run]      e.g. rollout.sh local-1a2b3c4d
source "$(dirname "$0")/../db/lib.sh"
TAG=${1:?tag}
PHASE=all
for a in "${@:2}"; do case $a in platform|tenant-db|tenant-schema|tenant-migrations|stores) PHASE=$a ;; esac; done
REG='708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com'
PLATFORM=($CTRL jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service jeffi-stores-mobile-service)
k8s_tunnel
manifests() { kubectl kustomize "$REPO/deploy/k8s/platform" | sed -E "s#(${REG}/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g"; }
tenants() { kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'; }

platform() {
  say "Platform at $TAG"
  if $DRY_RUN; then
    manifests | kubectl diff -f - || [ $? -eq 1 ]  # 1 = differences shown
    echo "Dry run: would apply the above and wait for ${PLATFORM[*]}."; return 0
  fi
  # The freeze suspends the 6-hourly ecr-refresh; renew the pull secret before the release images are pulled.
  if kubectl -n jeffi get cronjob ecr-refresh >/dev/null 2>&1; then
    job=ecr-refresh-$(date +%s)
    kubectl -n jeffi create job --from=cronjob/ecr-refresh "$job" >/dev/null
    kubectl -n jeffi wait --for=condition=complete "job/$job" --timeout=300s
  fi
  manifests | kubectl apply -f -
  for d in "${PLATFORM[@]}"; do kubectl -n jeffi rollout status deploy/$d --timeout=600s; done
  # Pre-rename platform objects (their routes would keep claiming the hosts).
  kubectl -n jeffi delete deploy/flagship svc/flagship sa/flagship pdb/flagship hpa/flagship \
    ingressroute/flagship ingressroute/flagship-admin ingressroute/flagship-cloudfront-origin --ignore-not-found
}

tenant_db() {
  if $DRY_RUN; then bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "${TAG#local-}" "$@" --dry-run
  else bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "${TAG#local-}" "$@"; fi
}

stores() {
  say "Stores"
  if $DRY_RUN; then
    for ns in $(tenants); do echo "── $ns"; kubectl -n "$ns" get deploy -l jeffi.io/service -o wide; done
    echo "Dry run: would re-apply each store at $TAG and wait for the deployments above."; return 0
  fi
  in_cluster reconcile_k8s /api/internal/provisioning/reconcile-k8s
  for ns in $(tenants); do
    echo "── $ns"
    for d in $(kubectl -n "$ns" get deploy -l jeffi.io/service -o name); do
      if ! kubectl -n "$ns" rollout status "$d" --timeout=600s; then
        kubectl -n "$ns" rollout undo "$d"
        echo "rollout failed in $ns ($d) — undone; remaining tenants left as they were" >&2
        exit 1
      fi
    done
  done
}

case $PHASE in
  platform) platform ;;
  tenant-db) tenant_db ;;
  tenant-schema) tenant_db --schema ;;
  tenant-migrations) tenant_db --migrations ;;
  stores) stores ;;
  all) platform; tenant_db; stores ;;
esac
