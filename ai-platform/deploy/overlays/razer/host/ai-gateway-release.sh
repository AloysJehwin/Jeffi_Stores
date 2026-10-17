#!/bin/bash
# Release the AI gateway on the Razer box at a commit: fetch that commit's ai-platform/ from GitHub, build the
# image into k3s containerd, apply the razer overlay, roll out and check it answers. Installed as
# /usr/local/sbin/ai-gateway-release; the pipeline reaches it over SSM -> the EC2 core -> Tailscale SSH with a
# key whose authorized_keys entry forces this script (--ssh), so that key can do nothing else.
#   ai-gateway-release release <sha> [--dry-run]   (dry run: kubectl diff only)
#   ai-gateway-release status
set -euo pipefail
REPO_TARBALL=https://codeload.github.com/AloysJehwin/Jeffi_Stores/tar.gz
LIVE=$HOME/jeffi-ai-platform
GATEWAY=http://localhost:8080
KUBECTL="sudo -n kubectl"

if [ "${1:-}" = --ssh ]; then
  # Forced command: the client's words arrive in SSH_ORIGINAL_COMMAND; only these two shapes are accepted.
  read -r -a args <<<"${SSH_ORIGINAL_COMMAND:-}"
  set -- "${args[@]}"
fi

status() {
  echo "image: $(sudo -n ctr -n k8s.io images ls -q 2>/dev/null | grep -m1 'jeffi/ai-gateway:latest' || echo none)"
  $KUBECTL -n ai-platform get deploy ai-gateway -o wide
  echo "healthz: $(curl -fsS --max-time 10 $GATEWAY/healthz || echo unreachable)"
}

case "${1:-}" in
  status) status; exit 0 ;;
  release) ;;
  *) echo "usage: release <sha> [--dry-run] | status" >&2; exit 2 ;;
esac
SHA=${2:-}
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad sha: $SHA" >&2; exit 2; }
DRY=false; [ "${3:-}" = --dry-run ] && DRY=true

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
echo "== Fetching ai-platform at ${SHA:0:8}"
curl -fsSL --max-time 300 "$REPO_TARBALL/$SHA" | tar -xz -C "$work" --strip-components=1 --wildcards '*/ai-platform/*'
src=$work/ai-platform
[ -f "$src/gateway/Dockerfile" ] || { echo "ai-platform not found at $SHA" >&2; exit 1; }

if $DRY; then
  echo "== Dry run: kubectl diff (nothing is built or applied)"
  $KUBECTL diff -k "$src/deploy/overlays/razer" || [ $? -eq 1 ]
  exit 0
fi

echo "== Building jeffi/ai-gateway:latest"
pgrep buildkitd >/dev/null || {
  sudo -n nohup /opt/buildkit/bin/buildkitd --oci-worker=false --containerd-worker=true \
    --containerd-worker-addr=/run/k3s/containerd/containerd.sock --containerd-worker-namespace=k8s.io >/tmp/buildkitd.log 2>&1 &
  sleep 3
}
(cd "$src" && sudo -n /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=gateway \
  --output type=image,name=docker.io/jeffi/ai-gateway:latest,unpack=true)

echo "== Applying the razer overlay and rolling out"
$KUBECTL apply -k "$src/deploy/overlays/razer"
$KUBECTL -n ai-platform rollout restart deploy/ai-gateway
$KUBECTL -n ai-platform rollout status deploy/ai-gateway --timeout=300s

echo "== Smoke test"
ok=false
for _ in $(seq 1 20); do curl -fsS --max-time 5 $GATEWAY/healthz >/dev/null && { ok=true; break; }; sleep 3; done
$ok || { echo "gateway not healthy after rollout" >&2; exit 1; }
curl -fsS --max-time 10 $GATEWAY/v1/providers; echo

echo "== Keeping the source as $LIVE (previous in $LIVE.prev)"
rm -rf "$LIVE.prev"; [ -d "$LIVE" ] && mv "$LIVE" "$LIVE.prev"
mv "$src" "$LIVE"
# This script updates itself to the released version (skipped, not fatal, when that commit predates it).
self=$LIVE/deploy/overlays/razer/host/ai-gateway-release.sh
if [ -f "$self" ]; then sudo -n install -m 0755 "$self" /usr/local/sbin/ai-gateway-release; else echo "(no release script at ${SHA:0:8}; kept the installed one)"; fi
echo "Released ai-gateway at ${SHA:0:8}"
