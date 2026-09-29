#!/usr/bin/env bash
# Install the Ollama GPU guard on the Razer node. Idempotent; safe to re-run after editing the
# script or units in this directory. Requires sudo on the node.
#
# WHY this is host-level and Razer-only: on the Razer, Ollama runs as the host's systemd service
# (not the in-cluster pod) because the ARC training tooling stops/starts it to free the single
# 12 GB GPU. The guard flips that systemd Ollama between GPU and CPU so the AI service never goes
# down while training holds the card. In the cloud overlay Ollama runs as its own always-on GPU
# pod and this guard is not used.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sudo install -m0755 "$here/ollama-gpu-guard.sh"      /usr/local/sbin/ollama-gpu-guard.sh
sudo install -m0644 "$here/ollama-gpu-guard.service" /etc/systemd/system/ollama-gpu-guard.service
sudo install -m0644 "$here/ollama-gpu-guard.timer"   /etc/systemd/system/ollama-gpu-guard.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ollama-gpu-guard.timer
sudo systemctl start ollama-gpu-guard.service
echo "guard installed; current mode: $(cat /run/ollama-gpu-guard.mode 2>/dev/null || echo unknown)"
