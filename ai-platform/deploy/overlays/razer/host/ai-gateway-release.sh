#!/bin/bash
# Release the AI gateway on the Razer box at a commit: fetch that commit's ai-platform/ from GitHub, build the
# gateway and PaddleOCR images into k3s containerd, apply the razer overlay, roll out and check they answer. Installed as
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
  echo "ocr image: $(sudo -n ctr -n k8s.io images ls -q 2>/dev/null | grep -m1 'jeffi/paddleocr:latest' || echo none)"
  $KUBECTL -n ai-platform get deploy ai-gateway -o wide
  $KUBECTL -n ai-platform get deploy paddleocr -o wide || true
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
# Download, then unpack: a DNS or network blip on the box is retried instead of handing tar a broken stream.
curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors --max-time 300 -o "$work/src.tar.gz" "$REPO_TARBALL/$SHA"
tar -xzf "$work/src.tar.gz" -C "$work" --strip-components=1 --wildcards '*/ai-platform/*'
src=$work/ai-platform
[ -f "$src/gateway/Dockerfile" ] || { echo "ai-platform not found at $SHA" >&2; exit 1; }
# Commits before the PaddleOCR sidecar have no image to build; its running Deployment is left as it is.
ocr=false; [ -f "$src/paddleocr/Dockerfile" ] && ocr=true

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
if $ocr; then
  # The first build fetches Paddle and the PP-OCRv5 models (a few minutes); later ones are cache hits.
  echo "== Building jeffi/paddleocr:latest"
  (cd "$src" && sudo -n /opt/buildkit/bin/buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=paddleocr \
    --output type=image,name=docker.io/jeffi/paddleocr:latest,unpack=true)
fi

echo "== Applying the razer overlay and rolling out"
$KUBECTL apply -k "$src/deploy/overlays/razer"
$KUBECTL -n ai-platform rollout restart deploy/ai-gateway
$ocr && $KUBECTL -n ai-platform rollout restart deploy/paddleocr
$KUBECTL -n ai-platform rollout status deploy/ai-gateway --timeout=300s
# Ready means the model is loaded; the old pod serves until then.
$ocr && $KUBECTL -n ai-platform rollout status deploy/paddleocr --timeout=300s

echo "== Smoke test"
ok=false
for _ in $(seq 1 20); do curl -fsS --max-time 5 $GATEWAY/healthz >/dev/null && { ok=true; break; }; sleep 3; done
$ok || { echo "gateway not healthy after rollout" >&2; exit 1; }
# /v1 needs the gateway's bearer token once AI_GATEWAY_TOKEN is set; read from its Secret into a 0600 header file
# (never argv). Empty file = no header. A "new,old" rotation value sends the first.
auth=$work/auth.header
(umask 077
 tok=$($KUBECTL -n ai-platform get secret ai-gateway-secret -o jsonpath='{.data.AI_GATEWAY_TOKEN}' 2>/dev/null | base64 -d 2>/dev/null || true)
 tok=${tok%%,*}
 if [ -n "$tok" ]; then printf 'Authorization: Bearer %s\n' "$tok" > "$auth"; else : > "$auth"; fi)
curl -fsS --max-time 10 -H "@$auth" $GATEWAY/v1/providers; echo
if $ocr; then
  # The sample through the gateway the way KYB reads a document: PaddleOCR only, 503 when it is down.
  printf '{"data":"%s","mime_type":"image/png"}' "$(base64 -w0 "$src/paddleocr/sample.png")" \
    | curl -fsS --max-time 60 -H 'Content-Type: application/json' -H "@$auth" --data-binary @- $GATEWAY/v1/ocr; echo
fi

echo "== Keeping the source as $LIVE (previous in $LIVE.prev)"
rm -rf "$LIVE.prev"; [ -d "$LIVE" ] && mv "$LIVE" "$LIVE.prev"
mv "$src" "$LIVE"
# This script updates itself to the released version (skipped, not fatal, when that commit predates it).
self=$LIVE/deploy/overlays/razer/host/ai-gateway-release.sh
if [ -f "$self" ]; then sudo -n install -m 0755 "$self" /usr/local/sbin/ai-gateway-release; else echo "(no release script at ${SHA:0:8}; kept the installed one)"; fi
echo "Released ai-gateway at ${SHA:0:8}"
