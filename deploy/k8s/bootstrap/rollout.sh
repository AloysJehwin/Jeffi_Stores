#!/bin/bash
# Roll a release: the platform (controller + messaging + document + public-api services, CronJobs) first,
# then every store tenant: the controller re-applies each store's namespace at the release images
# (its controller, messaging and document pods) and we wait for them, stopping at the first failure.
# Usage: rollout.sh <tag>      e.g. rollout.sh local-1a2b3c4d
set -euo pipefail
TAG=${1:?tag}
DIR=$(cd "$(dirname "$0")/.." && pwd)
REG='708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com'
CTRL=jeffi-stores-controller-service
PLATFORM=($CTRL jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service)

kubectl kustomize "$DIR/platform" | sed -E "s#(${REG}/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g" | kubectl apply -f -
for d in "${PLATFORM[@]}"; do kubectl -n jeffi rollout status deploy/$d --timeout=600s; done

# Pre-rename platform objects (their routes would keep claiming the hosts).
kubectl -n jeffi delete deploy/flagship svc/flagship sa/flagship pdb/flagship hpa/flagship \
  ingressroute/flagship ingressroute/flagship-admin ingressroute/flagship-cloudfront-origin --ignore-not-found

# Stores: re-applied in-cluster by the controller (it holds the k8s RBAC); the CRON_SECRET goes over stdin.
kubectl -n jeffi get secret cron-secret -o jsonpath='{.data.CRON_SECRET}' | base64 -d |
  kubectl -n jeffi exec -i deploy/$CTRL -- sh -c \
    'read -r CRON_SECRET; export CRON_SECRET CRON_TIMEOUT_MS=900000; exec node deploy/k8s-cron.mjs reconcile_k8s POST /api/internal/provisioning/reconcile-k8s'

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
