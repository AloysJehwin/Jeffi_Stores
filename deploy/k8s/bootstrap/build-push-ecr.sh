#!/bin/bash
# Build the app image locally (arm64) and push it to ECR — the GitHub-independent image path.
# Only NEXT_PUBLIC_* values are read from Secrets Manager (they ship in the browser bundle anyway).
# Usage: build-push-ecr.sh [tag]   → prints the pushed image ref on the last line
set -euo pipefail
REGION=us-east-1
REPO=jeffi-stores
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse --short HEAD)
TAG=${1:-local-$SHA}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
IMAGE=$REGISTRY/$REPO:$TAG

aws ecr describe-repositories --repository-names $REPO --region $REGION >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name $REPO --region $REGION \
    --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE >/dev/null

ARGS=()
while IFS= read -r line; do ARGS+=(--build-arg "$line"); done < <(
  aws secretsmanager get-secret-value --region $REGION --secret-id jeffi/production --query SecretString --output text |
    python3 -c 'import json,sys
for k,v in json.load(sys.stdin).items():
    if k.startswith("NEXT_PUBLIC_") and isinstance(v,str): print(f"{k}={v}")'
)
VERSION=$(node -p "require('./package.json').version")
ARGS+=(--build-arg "NEXT_PUBLIC_APP_VERSION=$VERSION" --build-arg "NEXT_PUBLIC_GIT_SHA=$SHA")
ARGS+=(--build-arg "DATABASE_URL=postgresql://build:build@localhost:5432/build" --build-arg "JWT_SECRET=build-only" --build-arg "SKIP_DB_CHECK=true")

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker buildx build --platform linux/arm64 "${ARGS[@]}" -t "$IMAGE" --push .
echo "$IMAGE"
