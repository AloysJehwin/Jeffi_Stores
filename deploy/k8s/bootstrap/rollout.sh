#!/bin/bash
# Roll a release, in phases (ci.yml runs each as its own job; no phase = all three, in order):
#   platform   the platform (controller; the flagship's storefront, admin and business; messaging, document,
#              public-api and mobile services; CronJobs), then its routes once those serve
#   tenant-db  the schema and migration files fanned out to every store tenant's database (40-tenant-fanout.sh);
#              tenant-schema / tenant-migrations run just one half (the pipeline's separate stages)
#   stores     every store: the controller re-applies its namespace at the release images (its storefront, admin,
#              business, messaging and document pods), moves a store still on the old all-in-one app onto those
#              (one store at a time), and we wait for them, stopping at the first failure
# --dry-run changes nothing: platform shows `kubectl diff`, tenant-db what it would post, stores what it would wait on.
# Usage: rollout.sh <tag> [platform|tenant-db|tenant-schema|tenant-migrations|stores] [--dry-run]      e.g. rollout.sh local-1a2b3c4d
source "$(dirname "$0")/../db/lib.sh"
TAG=${1:?tag}
PHASE=all
for a in "${@:2}"; do case $a in platform|tenant-db|tenant-schema|tenant-migrations|stores) PHASE=$a ;; esac; done
REG='708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com'
PLATFORM=($CTRL jeffi-stores-storefront-service jeffi-stores-admin-service jeffi-stores-business-service jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service jeffi-stores-mobile-service)
k8s_tunnel
manifests() { kubectl kustomize "$REPO/deploy/k8s/platform" | sed -E "s#(${REG}/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g"; }
tenants() { kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'; }
# The flagship's store pods the release adds to the core must fit its CPU, checked before anything changes.
core_room() {
  local node d
  node=$(kubectl get nodes -l jeffi.io/role=core -o jsonpath='{.items[0].metadata.name}')
  d=$(mktemp -d)
  manifests | kubectl create --dry-run=client -l jeffi.io/step=store -f - -o json > "$d/m.json"
  kubectl get node "$node" -o json > "$d/n.json"
  kubectl get pods -A --field-selector "spec.nodeName=$node" -o json > "$d/p.json"
  kubectl -n jeffi get deploy -o json > "$d/d.json"
  python3 -I "$REPO/deploy/k8s/bootstrap/core-room.py" "$d/m.json" "$d/n.json" "$d/p.json" "$d/d.json" || { rm -rf "$d"; return 1; }
  rm -rf "$d"
}

platform() {
  say "Platform at $TAG"
  core_room || exit 1
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
  # The flagship's store services first, then the routes (a path only moves once its service serves), then the
  # rest: the controller is control plane only, so it may only change once the store paths have left it.
  manifests | kubectl apply -l 'jeffi.io/step=store' -f -
  for d in "${PLATFORM[@]:1:3}"; do kubectl -n jeffi rollout status deploy/$d --timeout=600s; done
  manifests | kubectl apply -l 'jeffi.io/routes=platform' -f -
  manifests | kubectl apply -l 'jeffi.io/step!=store,jeffi.io/routes!=platform' -f -
  for d in "${PLATFORM[@]}"; do kubectl -n jeffi rollout status deploy/$d --timeout=600s; done
  # Earlier platform routes (their hosts are now claimed by 49-routes.yaml).
  kubectl -n jeffi delete deploy/flagship svc/flagship sa/flagship pdb/flagship hpa/flagship \
    ingressroute/flagship ingressroute/flagship-admin ingressroute/flagship-cloudfront-origin \
    ingressroute/jeffi-stores-controller-service ingressroute/jeffi-stores-controller-service-admin \
    ingressroute/jeffi-stores-controller-service-cloudfront-origin --ignore-not-found
}

tenant_db() {
  if $DRY_RUN; then bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "${TAG#local-}" "$@" --dry-run
  else bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "${TAG#local-}" "$@"; fi
}

stores() {
  say "Stores"
  if $DRY_RUN; then
    for ns in $(tenants); do echo "── $ns"; kubectl -n "$ns" get deploy -l jeffi.io/service -o wide; done
    echo "Dry run: would re-apply each store at $TAG, move any still on the old all-in-one app ($(kubectl get deploy -A -l jeffi.io/service=controller -o jsonpath='{.items[*].metadata.namespace}' 2>/dev/null || true)) onto its own services, and wait for the deployments above."; return 0
  fi
  in_cluster reconcile_k8s /api/internal/provisioning/reconcile-k8s
  for ns in $(tenants); do
    echo "── $ns"
    switch_layout "${ns#tenant-}" || exit 1
    for d in $(kubectl -n "$ns" get deploy -l jeffi.io/service -o name); do
      if ! kubectl -n "$ns" rollout status "$d" --timeout=600s; then
        kubectl -n "$ns" rollout undo "$d"
        echo "rollout failed in $ns ($d) — undone; remaining tenants left as they were" >&2
        exit 1
      fi
    done
  done
}

# Move a store still on the old all-in-one app onto its own services (a few minutes; the store keeps serving).
switch_layout() {
  local slug=$1 out status deadline=$((SECONDS + 1800))
  while :; do
    out=$(in_cluster switch_layout "/api/internal/provisioning/switch-layout?slug=$slug") || { echo "$out" >&2; return 1; }
    status=$(grep -oE '"status": "[a-z]+"' <<<"$out" | head -1 | cut -d'"' -f4 || true)
    case $status in
      services) return 0 ;;
      waiting) echo "   $slug stays on its old app for now: $(grep -oE '"detail": "[^"]*"' <<<"$out" | cut -d'"' -f4 || true)"; return 0 ;;
      failed)
        echo "$out" >&2
        echo "$slug could not move to its own services and is back on its old app; remaining tenants left as they were" >&2
        return 1 ;;
    esac
    [ $SECONDS -lt $deadline ] || { echo "$slug is still moving to its own services after 30 min" >&2; return 1; }
    sleep 15
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
