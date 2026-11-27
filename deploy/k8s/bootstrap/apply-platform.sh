#!/bin/bash
# Apply the platform in dependency order (first install). Usage: apply-platform.sh <image-tag>
# Without a tag the images keep the `set-by-rollout` placeholder and won't pull.
# JEFFI_CLOUD=azure installs the Azure overlay on the Azure core instead: ../overlays/azure-standby before the cutover
# (FLAGSHIP_CLOUD=aws: app CronJobs suspended, messaging, documents and voice at 0), ../overlays/azure after it.
set -euo pipefail
cd "$(dirname "$0")/../platform"
TAG=${1:-}
SRC=.
if [ "${JEFFI_CLOUD:-aws}" = azure ]; then
  case ${FLAGSHIP_CLOUD:-} in
    aws) SRC=../overlays/azure-standby ;; azure) SRC=../overlays/azure ;;
    *) echo "Set FLAGSHIP_CLOUD: aws before the cutover (Azure on standby), azure after it" >&2; exit 2 ;;
  esac
fi
if kubectl kustomize "$SRC" | grep -q REPLACE_ME; then echo "$SRC still has REPLACE_ME placeholders" >&2; exit 1; fi
if [ -n "$TAG" ]; then
  kubectl kustomize "$SRC" | sed -E "s#(708835965056\.dkr\.ecr\.us-east-1\.amazonaws\.com/jeffi-stores-[a-z-]+):[A-Za-z0-9._-]+#\1:${TAG}#g" | kubectl apply -f -
else
  kubectl apply -k "$SRC"
fi
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl wait --for condition=established crd/clusterissuers.cert-manager.io --timeout=120s
kubectl apply -f 21-issuers.yaml
# 50-observability.yaml holds both the operator (a HelmChart) and its Coroot resource, whose CRD exists only once the
# operator runs: on a fresh cluster apply it, wait for the CRD to appear, then apply it again.
kubectl apply -f 50-observability.yaml || true
for _ in $(seq 1 60); do kubectl get crd coroots.coroot.com >/dev/null 2>&1 && break; sleep 5; done
kubectl wait --for condition=established crd/coroots.coroot.com --timeout=120s
kubectl apply -f 50-observability.yaml
for d in jeffi-stores-controller-service jeffi-stores-storefront-service jeffi-stores-admin-service jeffi-stores-business-service jeffi-stores-messaging-service jeffi-stores-document-service jeffi-stores-public-api-service jeffi-stores-mobile-service jeffi-stores-showcase-service; do
  kubectl -n jeffi rollout status deploy/$d --timeout=600s
done
