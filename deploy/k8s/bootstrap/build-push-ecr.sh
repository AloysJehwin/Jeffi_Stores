#!/bin/bash
# Build one service image (arm64) and push it to ECR; skipped when the tag is already there.
# Usage: build-push-ecr.sh <controller|storefront|admin|business|messaging|documents|public-api|mobile> <tag> [context-dir]
#   context-dir defaults to the repo root (release.sh passes a `git archive` copy).
# Only NEXT_PUBLIC_* values are read from Secrets Manager (they ship in the browser bundle anyway).
set -euo pipefail
SERVICE=${1:?service}; TAG=${2:?tag}
CTX=${3:-$(git rev-parse --show-toplevel)}
REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
NEXT=
case $SERVICE in
  controller|storefront|admin|business)
              REPO=jeffi-stores-$SERVICE-service; BUILD=(-f deploy/next-app.Dockerfile --build-arg "APP=$SERVICE-service"); NEXT=1 ;;
  messaging)  REPO=jeffi-stores-messaging-service;  BUILD=(-f deploy/services.Dockerfile --target messaging) ;;
  documents)  REPO=jeffi-stores-document-service;   BUILD=(-f deploy/services.Dockerfile --target documents) ;;
  public-api) REPO=jeffi-stores-public-api-service; BUILD=(-f deploy/services.Dockerfile --target public-api) ;;
  mobile)     REPO=jeffi-stores-mobile-service;     BUILD=(-f deploy/services.Dockerfile --target mobile) ;;
  *) echo "unknown service $SERVICE" >&2; exit 1 ;;
esac
IMAGE=$REGISTRY/$REPO:$TAG

aws ecr describe-repositories --repository-names $REPO --region $REGION >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name $REPO --region $REGION \
    --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE >/dev/null
if aws ecr describe-images --region $REGION --repository-name $REPO --image-ids imageTag="$TAG" >/dev/null 2>&1; then
  echo "$IMAGE"; exit 0
fi

ARGS=()
if [ -n "${NEXT:-}" ]; then
  PUBLIC=$(aws secretsmanager get-secret-value --region $REGION --secret-id jeffi/production --query SecretString --output text |
    python3 -c 'import json,sys
for k,v in json.load(sys.stdin).items():
    if k.startswith("NEXT_PUBLIC_") and isinstance(v,str): print(f"{k}={v}")')
  while IFS= read -r line; do ARGS+=(--build-arg "$line"); done <<<"$PUBLIC"
  # The on-device summary pair may live in the environment (CI repo vars) rather than the secret.
  for k in NEXT_PUBLIC_ENABLE_ONDEVICE_SUMMARY NEXT_PUBLIC_ONDEVICE_MODEL_BASE; do
    grep -q "^$k=" <<<"$PUBLIC" || [ -z "${!k:-}" ] || ARGS+=(--build-arg "$k=${!k}")
  done
  ARGS+=(--build-arg "NEXT_PUBLIC_APP_VERSION=$(node -p "require('$CTX/package.json').version")" --build-arg "NEXT_PUBLIC_GIT_SHA=${TAG#local-}")
  ARGS+=(--build-arg "DATABASE_URL=postgresql://build:build@localhost:5432/build" --build-arg "JWT_SECRET=build-only" --build-arg "SKIP_DB_CHECK=true")
fi

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
# BUILDX_CACHE_ARGS: e.g. "--cache-from type=gha,scope=$SERVICE --cache-to type=gha,mode=max,scope=$SERVICE" in CI.
# shellcheck disable=SC2086
(cd "$CTX" && docker buildx build --platform linux/arm64 "${BUILD[@]}" "${ARGS[@]}" ${BUILDX_CACHE_ARGS:-} -t "$IMAGE" --push .)
echo "$IMAGE"
