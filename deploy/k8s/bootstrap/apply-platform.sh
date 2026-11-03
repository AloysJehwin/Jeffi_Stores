#!/bin/bash
# Apply the platform in dependency order (first install). Usage: apply-platform.sh <image-tag>
# Without a tag the images keep the `set-by-rollout` placeholder and won't pull.
set -euo pipefail
cd "$(dirname "$0")/../platform"
TAG=${1:-}
if [ -n "$TAG" ]; then
  kubectl kustomize . | sed -E "s#(708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g" | kubectl apply -f -
else
  kubectl apply -k .
fi
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl wait --for condition=established crd/clusterissuers.cert-manager.io --timeout=120s
kubectl apply -f 21-issuers.yaml
kubectl wait --for condition=established crd/coroots.coroot.com --timeout=300s 2>/dev/null || sleep 30
kubectl apply -f 50-observability.yaml
for d in jeffi-stores-controller-service jeffi-stores-storefront-service jeffi-stores-admin-service jeffi-stores-business-service jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service jeffi-stores-mobile-service; do
  kubectl -n jeffi rollout status deploy/$d --timeout=600s
done
