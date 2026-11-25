#!/bin/bash
# Release the Razer box's LLM service at a commit: fetch that commit's ai-platform/ from GitHub, build the PaddleOCR
# image into k3s containerd, apply the razer overlay, roll PaddleOCR out and check it answers. The AI gateway no
# longer runs here (it is a platform service in the main cluster); the file keeps its name because the installed copy
# and the forced-command key point at /usr/local/sbin/ai-gateway-release. The pipeline reaches it over SSM -> the EC2
# core -> Tailscale SSH with a key whose authorized_keys entry forces this script (--ssh), so that key can do nothing
# else.
#   ai-gateway-release release <sha> [--dry-run]   (dry run: kubectl diff only)
#   ai-gateway-release status
#   ai-gateway-release retire-gateway              (once the platform gateway serves: removes the old gateway + Redis)
set -euo pipefail
REPO_TARBALL=https://codeload.github.com/AloysJehwin/Jeffi_Stores/tar.gz
LIVE=$HOME/jeffi-ai-platform
OCR=http://localhost:8866
KUBECTL="sudo -n kubectl"

if [ "${1:-}" = --ssh ]; then
  # Forced command: the client's words arrive in SSH_ORIGINAL_COMMAND; only these three shapes are accepted.
  read -r -a args <<<"${SSH_ORIGINAL_COMMAND:-}"
  set -- "${args[@]}"
fi

status() {
  echo "ocr image: $(sudo -n ctr -n k8s.io images ls -q 2>/dev/null | grep -m1 'jeffi/paddleocr:latest' || echo none)"
  $KUBECTL -n ai-platform get deploy paddleocr -o wide || true
  echo "ocr health: $(curl -fsS --max-time 10 "$OCR/health?ready=1" || echo unreachable)"
  echo "ollama: $(curl -fsS --max-time 10 http://localhost:11434/api/version || echo unreachable)"
  echo "image server: $(curl -fsS --max-time 10 -o /dev/null http://localhost:7860/sdapi/v1/options && echo up || echo unreachable)"
  echo "old gateway: $($KUBECTL -n ai-platform get deploy ai-gateway --no-headers 2>/dev/null | cut -c1-40 || true)"
}

# The gateway and its Redis now run in the main cluster. Run this only after /v1/providers answers there and the apps
# use it (deploy/k8s/README.md, "AI gateway cutover"). The Redis volume is kept: delete ai-redis-data by hand later.
retire_gateway() {
  $KUBECTL -n ai-platform delete deploy/ai-gateway hpa/ai-gateway svc/ai-gateway svc/ai-gateway-lb \
    statefulset/ai-redis svc/ai-redis sa/ai-gateway cm/ai-gateway-config --ignore-not-found
  echo "Retired the Razer gateway. Secret ai-gateway-secret and PVC ai-redis-data are kept; delete them when sure."
}

case "${1:-}" in
  status) status; exit 0 ;;
  retire-gateway) retire_gateway; exit 0 ;;
  release) ;;
  *) echo "usage: release <sha> [--dry-run] | status | retire-gateway" >&2; exit 2 ;;
esac
SHA=${2:-}
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "bad sha: $SHA" >&2; exit 2; }
DRY=false; [ "${3:-}" = --dry-run ] && DRY=true

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
echo "== Fetching ai-platform at ${SHA:0:8}"
# Download, then unpack: a DNS or network blip on the box is retried instead of handing tar a broken stream.
curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors --max-time 300 -o "$work/src.tar.gz" "$REPO_TARBALL/$SHA"
tar -xzf "$work/src.tar.gz" -C "$work" --strip-components=1 --wildcards '*/ai-platform/*'
src=$work/ai-platform
[ -f "$src/paddleocr/Dockerfile" ] || { echo "ai-platform not found at $SHA" >&2; exit 1; }

if $DRY; then
  echo "== Dry run: kubectl diff (nothing is built or applied)"
  $KUBECTL diff -k "$src/deploy/overlays/razer" || [ $? -eq 1 ]
  exit 0
fi

echo "== Building jeffi/paddleocr:latest"
pgrep buildkitd >/dev/null || {
  sudo -n nohup /opt/buildkit/bin/buildkitd --oci-worker=false --containerd-worker=true \
    --containerd-worker-addr=/run/k3s/containerd/containerd.sock --containerd-worker-namespace=k8s.io >/tmp/buildkitd.log 2>&1 &
  sleep 3
}
# The first build fetches Paddle and the PP-OCRv5 models (a few minutes); later ones are cache hits.
(cd "$src" && sudo -n /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=paddleocr \
  --output type=image,name=docker.io/jeffi/paddleocr:latest,unpack=true)

echo "== Applying the razer overlay and rolling out"
$KUBECTL apply -k "$src/deploy/overlays/razer"
$KUBECTL -n ai-platform rollout restart deploy/paddleocr
# Ready means the model is loaded; the old pod serves until then.
$KUBECTL -n ai-platform rollout status deploy/paddleocr --timeout=300s

echo "== Smoke test"
ok=false
for _ in $(seq 1 20); do curl -fsS --max-time 5 "$OCR/health?ready=1" >/dev/null && { ok=true; break; }; sleep 3; done
$ok || { echo "PaddleOCR not ready after rollout" >&2; exit 1; }
# A sample the way KYB reads a document, straight at the sidecar (the gateway in the main cluster forwards to it).
printf '{"data":"%s","mime_type":"image/png"}' "$(base64 -w0 "$src/paddleocr/sample.png")" \
  | curl -sS --fail-with-body --max-time 60 -H 'Content-Type: application/json' --data-binary @- $OCR/ocr; echo

echo "== Keeping the source as $LIVE (previous in $LIVE.prev)"
rm -rf "$LIVE.prev"; [ -d "$LIVE" ] && mv "$LIVE" "$LIVE.prev"
mv "$src" "$LIVE"
# This script updates itself to the released version (skipped, not fatal, when that commit predates it).
self=$LIVE/deploy/overlays/razer/host/ai-gateway-release.sh
if [ -f "$self" ]; then sudo -n install -m 0755 "$self" /usr/local/sbin/ai-gateway-release; else echo "(no release script at ${SHA:0:8}; kept the installed one)"; fi
echo "Released the Razer LLM service at ${SHA:0:8}"
