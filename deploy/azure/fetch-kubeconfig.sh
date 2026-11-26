#!/bin/bash
# Copies the Azure core's tailnet kubeconfig (/root/jeffi-azure.yaml, written by cloud-init/core.sh) to
# ~/.kube/jeffi-azure.yaml (0600). First `tailscale ssh jeffi@jeffi-k8s-core-az` (needs the ssh rule in
# deploy/tailscale/azure-acl-snippet.hujson); if the tailnet refuses, `az vm run-command invoke` on the core VM.
# The kubeconfig goes straight to a 0600 file and is never printed. --github also stores it, base64, as the repository
# secret KUBECONFIG_AZURE_B64 (`gh secret set`, value on stdin, never argv; the repo is gh's: run inside the checkout or
# set GH_REPO=owner/name).
# Dry run by default: prints the plan. --apply fetches. --github (with --apply) sets the secret.
# Usage: bash deploy/azure/fetch-kubeconfig.sh [--apply] [--github]
set -euo pipefail
RG=${AZ_RG:-jeffi-prod-cin}
VM=${AZ_CORE_VM:-jeffi-prod-core}
SUBSCRIPTION=${AZ_SUBSCRIPTION:-Azure subscription 1}
HOST=${CORE_TS_HOST:-jeffi-k8s-core-az}
SRC=/root/jeffi-azure.yaml
DEST=${KUBECONFIG_DEST:-$HOME/.kube/jeffi-azure.yaml}
APPLY=false GITHUB=false
for a in "$@"; do case $a in --apply) APPLY=true ;; --github) GITHUB=true ;; *) echo "unknown argument $a" >&2; exit 2 ;; esac; done

if ! $APPLY; then
  echo "Dry run. With --apply:"
  echo "  1. tailscale ssh jeffi@$HOST sudo cat $SRC  -> $DEST (0600)"
  echo "  2. if ssh is refused: az vm run-command invoke -g $RG -n $VM (subscription $SUBSCRIPTION), result parsed into $DEST"
  if $GITHUB; then echo "  3. gh secret set KUBECONFIG_AZURE_B64 (base64 of $DEST, on stdin)"; fi
  echo "The kubeconfig is never printed."
  exit 0
fi

umask 077
mkdir -p "$(dirname "$DEST")"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
valid() { grep -q '^apiVersion:' "$1" && grep -q 'server: https://' "$1"; }

got=false
if command -v tailscale >/dev/null && tailscale ssh "jeffi@$HOST" sudo cat "$SRC" > "$tmp/kc" 2>"$tmp/err" && valid "$tmp/kc"; then
  got=true; echo "fetched over tailscale ssh"
else
  echo "tailscale ssh unavailable or refused; trying az vm run-command (slow, about 30s)"
fi
if ! $got; then
  az account set --subscription "$SUBSCRIPTION"
  az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript --scripts "cat $SRC" -o json > "$tmp/rc.json"
  python3 -I -c '
import json, sys
m = json.load(open(sys.argv[1]))["value"][0]["message"]
out = m.split("[stdout]\n", 1)[1].split("\n[stderr]", 1)[0]
open(sys.argv[2], "w").write(out.rstrip("\n") + "\n")' "$tmp/rc.json" "$tmp/kc"
  valid "$tmp/kc" || { echo "run-command returned no kubeconfig (is cloud-init finished on $VM?)" >&2; exit 1; }
  echo "fetched with az vm run-command"
fi
install -m 600 "$tmp/kc" "$DEST"
echo "wrote $DEST (0600), $(grep -m1 'server: https://' "$DEST" | sed 's/^ *//')"

if $GITHUB; then
  base64 < "$DEST" | tr -d '\n' | gh secret set KUBECONFIG_AZURE_B64
  echo "set repository secret KUBECONFIG_AZURE_B64"
fi
echo "Check: KUBECONFIG=$DEST kubectl get nodes"
