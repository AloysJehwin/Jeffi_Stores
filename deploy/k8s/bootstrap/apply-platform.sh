#!/bin/bash
# Apply the platform in dependency order. Usage: apply-platform.sh [image-tag]
set -euo pipefail
cd "$(dirname "$0")/../platform"
TAG=${1:-}
if [ -n "$TAG" ]; then
  kubectl kustomize . | sed "s#708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:latest#708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:${TAG}#g" | kubectl apply -f -
else
  kubectl apply -k .
fi
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl wait --for condition=established crd/clusterissuers.cert-manager.io --timeout=120s
kubectl apply -f 21-issuers.yaml
kubectl wait --for condition=established crd/coroots.coroot.com --timeout=300s 2>/dev/null || sleep 30
kubectl apply -f 50-observability.yaml
kubectl -n jeffi rollout status deploy/flagship --timeout=600s
