#!/usr/bin/env bash
# Restarts k3s when the box's LAN address changes under it. k3s keeps the node IP it saw at start (no
# --node-ip here), so after a DHCP change pods lose the API (10.43.0.1 -> old IP:6443) and CoreDNS freezes
# its Service list: Services created after that never resolve (2026-11-18: /v1/ocr 503, paddleocr ENOTFOUND).
# Acts when the same mismatch holds on two ticks in a row, at most once per 30 minutes.
#   k3s-ip-guard.sh          check and fix (k3s-ip-guard.timer, every 60s)
#   k3s-ip-guard.sh --check  report only; exit 1 on a mismatch
set -euo pipefail
STATE=${K3S_IP_GUARD_STATE:-/run/k3s-ip-guard}
COOLDOWN=1800
mkdir -p "$STATE"

host_ip() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true; }
# IPv4 only: the node also carries an IPv6 InternalIP from the ISP's prefix.
node_ip() {
  kubectl get node "$(hostname | tr '[:upper:]' '[:lower:]')" \
    -o jsonpath='{range .status.addresses[?(@.type=="InternalIP")]}{.address}{"\n"}{end}' 2>/dev/null \
    | grep -m1 -E '^[0-9.]+$' || true
}
api_endpoints() {
  kubectl -n default get endpointslices -l kubernetes.io/service-name=kubernetes \
    -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{"\n"}{end}' 2>/dev/null \
    | grep -E '^[0-9.]+$' | sort -u | paste -sd' ' - || true
}

host=$(host_ip)
node=$(node_ip)
if [ "${1:-}" = --check ]; then
  echo "host ${host:-none}, k3s node ${node:-unknown}"
  [ -n "$host" ] && [ "$host" = "$node" ]
  exit
fi

# No default route (Wi-Fi down) or k3s not answering: nothing to compare.
if [ -z "$host" ] || [ -z "$node" ] || [ "$host" = "$node" ]; then
  rm -f "$STATE/pending"
  exit 0
fi
if [ "$(cat "$STATE/pending" 2>/dev/null || true)" != "$host" ]; then
  echo "k3s node is on $node, host now $host; restarting k3s next tick if it holds"
  echo "$host" >"$STATE/pending"
  exit 0
fi
last=$(cat "$STATE/last-restart" 2>/dev/null || echo 0)
if [ $(($(date +%s) - last)) -lt $COOLDOWN ]; then
  echo "k3s node is on $node, host on $host, but k3s was restarted under 30 min ago; leaving it"
  exit 0
fi

echo "k3s node is on $node, host on $host: restarting k3s (running pods keep going)"
date +%s >"$STATE/last-restart"
rm -f "$STATE/pending"
systemctl restart k3s
# The node address moves first; the old kubernetes endpoint goes once its lease expires.
settled=false
for _ in $(seq 1 60); do
  sleep 5
  [ "$(node_ip)" = "$host" ] && [ "$(api_endpoints)" = "$host" ] && { settled=true; break; }
done
$settled || { echo "k3s restarted but did not settle on $host within 5 min (node $(node_ip), api $(api_endpoints))" >&2; exit 1; }
# CoreDNS's watch died with the old address; a new pod lists every Service again.
kubectl -n kube-system rollout restart deploy/coredns
kubectl -n kube-system rollout status deploy/coredns --timeout=120s
echo "k3s now on $host; CoreDNS restarted"
