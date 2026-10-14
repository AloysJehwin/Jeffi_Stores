#!/bin/bash
# Roll a release: the platform (controller, messaging, document and public-api services, CronJobs), the tenant
# schema fan-out, then every store tenant: the controller re-applies each store's namespace at the release
# images (its controller, messaging and document pods) and we wait for them, stopping at the first failure.
# Usage: rollout.sh <tag>      e.g. rollout.sh local-1a2b3c4d
source "$(dirname "$0")/../db/lib.sh"
TAG=${1:?tag}
REG='708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com'
PLATFORM=($CTRL jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service)
k8s_tunnel

say "Platform at $TAG"
kubectl kustomize "$REPO/deploy/k8s/platform" | sed -E "s#(${REG}/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g" | kubectl apply -f -
for d in "${PLATFORM[@]}"; do kubectl -n jeffi rollout status deploy/$d --timeout=600s; done

# Pre-rename platform objects (their routes would keep claiming the hosts).
kubectl -n jeffi delete deploy/flagship svc/flagship sa/flagship pdb/flagship hpa/flagship \
  ingressroute/flagship ingressroute/flagship-admin ingressroute/flagship-cloudfront-origin --ignore-not-found

bash "$REPO/deploy/k8s/db/40-tenant-fanout.sh" "${TAG#local-}"

say "Stores"
in_cluster reconcile_k8s /api/internal/provisioning/reconcile-k8s
for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
  echo "── $ns"
  for d in $(kubectl -n "$ns" get deploy -l jeffi.io/service -o name); do
    if ! kubectl -n "$ns" rollout status "$d" --timeout=600s; then
      kubectl -n "$ns" rollout undo "$d"
      echo "rollout failed in $ns ($d) — undone; remaining tenants left as they were" >&2
      exit 1
    fi
  done
done
