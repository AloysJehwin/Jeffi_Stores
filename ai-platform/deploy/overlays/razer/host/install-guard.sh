#!/usr/bin/env bash
# Install the Razer node's host guards. Idempotent; safe to re-run after editing the scripts or units
# in this directory. Requires sudo on the node.
#
# Ollama GPU guard: on the Razer, Ollama runs as the host's systemd service (not the in-cluster pod)
# because the ARC training tooling stops/starts it to free the single 12 GB GPU. The guard flips that
# systemd Ollama between GPU and CPU so the AI service never goes down while training holds the card.
# In the cloud overlay Ollama runs as its own always-on GPU pod and this guard is not used.
#
# k3s IP guard: the box is on home Wi-Fi with a DHCP address, and k3s keeps the node IP it started
# with; the guard restarts k3s (and CoreDNS) when the two drift apart (k3s-ip-guard.sh).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sudo install -m0755 "$here/ollama-gpu-guard.sh"      /usr/local/sbin/ollama-gpu-guard.sh
sudo install -m0644 "$here/ollama-gpu-guard.service" /etc/systemd/system/ollama-gpu-guard.service
sudo install -m0644 "$here/ollama-gpu-guard.timer"   /etc/systemd/system/ollama-gpu-guard.timer
sudo install -m0755 "$here/k3s-ip-guard.sh"          /usr/local/sbin/k3s-ip-guard.sh
sudo install -m0644 "$here/k3s-ip-guard.service"     /etc/systemd/system/k3s-ip-guard.service
sudo install -m0644 "$here/k3s-ip-guard.timer"       /etc/systemd/system/k3s-ip-guard.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ollama-gpu-guard.timer k3s-ip-guard.timer
sudo systemctl start ollama-gpu-guard.service
echo "guards installed; Ollama mode: $(cat /run/ollama-gpu-guard.mode 2>/dev/null || echo unknown);" \
  "$(sudo /usr/local/sbin/k3s-ip-guard.sh --check || true)"
