#!/bin/bash
# Release the committed HEAD, from a Mac or from GitHub Actions (ci.yml): build the four images (arm64) from a
# clean `git archive`, push them to ECR (tags already there are skipped), roll out with rollout.sh, smoke-test.
# --build-only stops after the push, so images can be ready before a window; --rollout-only skips the builds
# (CI builds them in parallel first). Images are tagged local-<image_sha> (lib.sh): commits that only touch
# docs or deploy/k8s reuse the images already pushed, and a Mac and CI build of the same commit share a tag.
# Usage: bash deploy/k8s/bootstrap/release.sh [--build-only|--rollout-only]
source "$(dirname "$0")/../db/lib.sh"
WORK=${RELEASE_WORK_DIR:-${TMPDIR:-/tmp}/jeffi-release}
cd "$REPO"

[ -z "$(git status --porcelain -- controller-service messaging-service document-service public-api-service packages deploy database package.json package-lock.json vendor)" ] ||
  { echo "Uncommitted changes — commit first so the release is reproducible." >&2; exit 1; }
SHA=$(image_sha); TAG=local-$SHA
mkdir -p "$WORK"
if [ "${1:-}" = --rollout-only ]; then
  echo "== 1/3 Images at $TAG (HEAD $(git rev-parse --short HEAD); built already)"
else
  free_gb=$(df -Pk "$HOME" | awk 'NR==2 {print int($4/1048576)}')
  [ "$free_gb" -ge 15 ] || { echo "Only ${free_gb} GB free; the builds need ~15 GB (Docker corrupts its disk when it runs out)." >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }

  echo "== 1/3 Images at $TAG (HEAD $(git rev-parse --short HEAD); logs in $WORK)"
  rm -rf "$WORK" && mkdir -p "$WORK/src"
  git archive HEAD | tar x -C "$WORK/src"
  for s in controller messaging documents public-api; do
    printf '   %-11s' "$s"
    bash deploy/k8s/bootstrap/build-push-ecr.sh "$s" "$TAG" "$WORK/src" > "$WORK/build-$s.log" 2>&1 ||
      { echo failed; tail -30 "$WORK/build-$s.log"; exit 1; }
    tail -1 "$WORK/build-$s.log"
  done
  docker builder prune -af >/dev/null 2>&1 || true
  if [ "${1:-}" = --build-only ]; then echo "Pushed. Roll out with: bash deploy/k8s/bootstrap/release.sh"; exit 0; fi
fi

echo "== 2/3 Roll out"
bash deploy/k8s/bootstrap/rollout.sh "$TAG"

echo "== 3/3 Smoke test"
health=$(curl -s --max-time 15 https://jeffistores.in/api/health)
echo "   $health"
echo "$health" | grep -q "\"commit\":\"$SHA\"" || { echo "   live commit is not $SHA" >&2; exit 1; }
URLS="https://jeffistores.in/ https://business.jeffistores.in/ https://ecom.jeffistores.in/ https://public.jeffistores.in/healthz"
for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
  host=$(kubectl -n "$ns" get ingressroute controller -o jsonpath='{.spec.routes[0].match}' 2>/dev/null | sed -E 's/^Host\(`([^`]+)`.*/\1/')
  [ -n "$host" ] && URLS="$URLS https://$host/api/health"
done
for u in $URLS; do printf '   %s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")" "$u"; done
echo "== Released $SHA. Roll back the platform: kubectl -n jeffi rollout undo deploy/<jeffi-stores-*-service>;"
echo "   a store: kubectl -n tenant-<slug> rollout undo deploy/<slug>-{controller,messaging,document}-service"
