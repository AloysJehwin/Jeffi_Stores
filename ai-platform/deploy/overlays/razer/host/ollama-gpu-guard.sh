#!/usr/bin/env bash
# Keeps Ollama always running, but off the GPU whenever another process is using it.
# GPU free  -> Ollama with GPU access (fast).
# GPU busy  -> Ollama pinned to CPU (slower but never down), so a training job gets the full card.
# The decision is written to a systemd drop-in read by ollama.service; Ollama is only restarted
# when the mode actually changes, so steady state is a no-op.
set -euo pipefail

DROPIN=/etc/systemd/system/ollama.service.d/10-gpu-guard.conf
STATE=/run/ollama-gpu-guard.mode

# PIDs of the Ollama service tree (server + its llama-server workers): these are "ours".
ours="$(systemctl show -p MainPID --value ollama 2>/dev/null || echo 0)"
if [ "${ours:-0}" != "0" ]; then
  ours="$ours $(pgrep -P "$ours" 2>/dev/null | tr '\n' ' ' || true)"
fi
is_ours() { for p in $ours; do [ "$1" = "$p" ] && return 0; done; return 1; }

# A foreign GPU process = any compute app on the GPU that is not part of the Ollama tree.
foreign=0
while IFS=, read -r pid _; do
  pid="$(echo "$pid" | tr -d ' ')"
  [ -z "$pid" ] && continue
  is_ours "$pid" || foreign=1
done < <(nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader 2>/dev/null || true)


want=gpu
[ "$foreign" = "1" ] && want=cpu

have="$(cat "$STATE" 2>/dev/null || echo none)"
[ "$want" = "$have" ] && exit 0   # steady state: nothing to do

mkdir -p "$(dirname "$DROPIN")"
if [ "$want" = "cpu" ]; then
  cat > "$DROPIN" <<CONF
[Service]
Environment="CUDA_VISIBLE_DEVICES="
Environment="OLLAMA_MAX_LOADED_MODELS=1"
CONF
else
  cat > "$DROPIN" <<CONF
[Service]
Environment="OLLAMA_MAX_LOADED_MODELS=1"
CONF
fi
systemctl daemon-reload
systemctl restart ollama
echo "$want" > "$STATE"
logger -t ollama-gpu-guard "switched Ollama to $want (foreign GPU user: $foreign)"
