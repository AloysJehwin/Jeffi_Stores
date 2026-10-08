#!/bin/bash
# Build the committed HEAD on this Mac (arm64), push to ECR, and roll it out to k3s.
# Stand-in for CI while GitHub Actions is unavailable. Usage: bash deploy/k8s/bootstrap/deploy-local.sh
#   - builds from `git archive HEAD` (a clean copy; uncommitted changes and local files never ship)
#   - refuses to run with uncommitted changes, so what's deployed is always a commit
#   - only NEXT_PUBLIC_* values are read from Secrets Manager (they ship in the browser bundle anyway)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
REG=708835965056.dkr.ecr.us-east-1.amazonaws.com
WORK=${TMPDIR:-/tmp}/jeffi-deploy
export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-k3s.yaml}
cd "$REPO"

[ -z "$(git status --porcelain -- src deploy database public package.json package-lock.json Dockerfile vendor)" ] ||
  { echo "Uncommitted changes — commit first so the deploy is reproducible." >&2; exit 1; }
SHA=$(git rev-parse --short HEAD)
IMG=$REG/jeffi-stores:local-$SHA
free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
[ "$free_gb" -ge 15 ] || { echo "Only ${free_gb} GB free; the build needs ~15 GB (Docker corrupts its disk when it runs out)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Desktop is not running." >&2; exit 1; }

echo "== 1/4 Prepare $SHA"
rm -rf "$WORK" && mkdir -p "$WORK/src"
git archive HEAD | tar x -C "$WORK/src"
aws secretsmanager get-secret-value --secret-id jeffi/production --query SecretString --output text |
  python3 -c 'import json,sys
for k,v in json.load(sys.stdin).items():
    if k.startswith("NEXT_PUBLIC_") and isinstance(v,str): print(f"{k}={v}")' > "$WORK/args"
echo "NEXT_PUBLIC_APP_VERSION=$(node -p "require('./package.json').version")" >> "$WORK/args"
echo "NEXT_PUBLIC_GIT_SHA=$SHA" >> "$WORK/args"
ARGS=(); while IFS= read -r l; do ARGS+=(--build-arg "$l"); done < "$WORK/args"

if aws ecr describe-images --repository-name jeffi-stores --image-ids imageTag="local-$SHA" >/dev/null 2>&1; then
  echo "== 2/4 Image local-$SHA already in ECR, skipping build"
else
  echo "== 2/4 Build + push (~10-15 min, log: $WORK/build.log)"
  aws ecr get-login-password | docker login -u AWS --password-stdin "$REG" >/dev/null
  (cd "$WORK/src" && docker buildx build --platform linux/arm64 "${ARGS[@]}" \
    --build-arg DATABASE_URL=postgresql://b:b@localhost:5432/b --build-arg JWT_SECRET=build-only --build-arg SKIP_DB_CHECK=true \
    -t "$IMG" --push . > "$WORK/build.log" 2>&1) || { tail -30 "$WORK/build.log"; exit 1; }
  aws ecr describe-images --repository-name jeffi-stores --image-ids imageTag="local-$SHA" >/dev/null
  docker builder prune -af >/dev/null 2>&1 || true
fi

echo "== 3/4 Roll out"
kubectl get nodes >/dev/null 2>&1 || ssh -i ~/.ssh/jeffi-stores-key.pem -f -N -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -L 16443:127.0.0.1:6443 ec2-user@32.196.38.130
bash deploy/k8s/bootstrap/rollout.sh "$IMG"

echo "== 4/4 Smoke test"
health=$(curl -s --max-time 15 https://jeffistores.in/api/health)
echo "   $health"
echo "$health" | grep -q "\"commit\":\"$SHA\"" || { echo "   live commit is not $SHA" >&2; exit 1; }
for u in https://jeffistores.in/ https://business.jeffistores.in/ https://ecom.jeffistores.in/; do
  printf '   %s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")" "$u"
done
echo "== Deployed $SHA. Rollback: kubectl -n jeffi rollout undo deploy/flagship"
