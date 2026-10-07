#!/bin/bash
# Roll a new image: platform (flagship + CronJobs) first, then every tenant namespace one at a
# time, stopping at the first failure (kubectl rollout undo is the rollback).
# Usage: rollout.sh 708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:main-<sha>
set -euo pipefail
IMAGE=${1:?image}
DIR=$(cd "$(dirname "$0")/.." && pwd)

kubectl kustomize "$DIR/platform" | sed "s#708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:latest#${IMAGE}#g" | kubectl apply -f -
kubectl -n jeffi rollout status deploy/flagship --timeout=600s

for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
  echo "── $ns"
  kubectl -n "$ns" set image deploy/storefront app="$IMAGE"
  if ! kubectl -n "$ns" rollout status deploy/storefront --timeout=600s; then
    kubectl -n "$ns" rollout undo deploy/storefront
    echo "rollout failed in $ns — undone; remaining tenants left on the previous image" >&2
    exit 1
  fi
done
