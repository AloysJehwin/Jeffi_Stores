#!/bin/bash
# First boot of the Azure k3s core (Ubuntu 24.04 arm64), from modules/core-vm.bicep: Tailscale (subnet router for the
# Postgres subnet and Azure DNS), then the k3s server with flannel over tailscale0, so AWS store and edge nodes join
# the same cluster, and with the service-account issuer that AWS STS and Entra trust (deploy/azure/README.md).
# Secrets come from Key Vault through the VM identity; no `set -x`, so no value reaches the cloud-init log.
# Placeholders are filled by Bicep. Idempotent on reboot.
set -euo pipefail
KV=__KEY_VAULT__
ISSUER=__OIDC_ISSUER__
ROUTES=__ADVERTISE_ROUTES__
# IMDS leaves publicIpAddress empty for Standard-SKU public IPs, so Bicep passes the static IP in.
PUBLIC_IP=__PUBLIC_IP__
export DEBIAN_FRONTEND=noninteractive
command -v jq >/dev/null || { apt-get update -q && apt-get install -y -q jq curl; }

imds() { curl -fsS -H Metadata:true "http://169.254.169.254/metadata/$1"; }
kv_token() { imds 'identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net' | jq -r .access_token; }
# <secret> [json key]: the role assignment can take minutes to apply after the VM exists, so wait up to 20 minutes.
kv_get() {
  local v='' n
  for n in $(seq 1 60); do
    v=$(curl -fsS -H "Authorization: Bearer $(kv_token)" "https://$KV.vault.azure.net/secrets/$1?api-version=7.4" 2>/dev/null | jq -r '.value // empty') || v=
    [ -n "$v" ] && break
    echo "waiting for Key Vault secret $1 ($n/60)"; sleep 20
  done
  [ -n "$v" ] || { echo "Key Vault secret $1 unreadable" >&2; return 1; }
  if [ -n "${2:-}" ]; then jq -r --arg k "$2" '.[$k] // empty' <<<"$v"; else printf '%s' "$v"; fi
}

cat > /etc/sysctl.d/90-jeffi-router.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sysctl --system >/dev/null

if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
systemctl enable --now tailscaled
if ! tailscale status >/dev/null 2>&1; then
  TSKEY=$(kv_get jeffi-production-k3s TS_AUTHKEY)
  tailscale up --authkey "$TSKEY" --hostname jeffi-k8s-core-az --advertise-tags tag:server-prod \
    --advertise-routes "$ROUTES" --accept-dns=false --ssh
  unset TSKEY
fi
TS_IP=
for _ in $(seq 1 30); do TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true); [ -n "$TS_IP" ] && break; sleep 2; done
[ -n "$TS_IP" ] || { echo "no Tailscale address" >&2; exit 1; }
EXTERNAL_IP_ARGS=()
[ -n "$PUBLIC_IP" ] && EXTERNAL_IP_ARGS=(--node-external-ip "$PUBLIC_IP")

if ! command -v k3s >/dev/null; then
  K3S_TOKEN=$(kv_get jeffi-production-k3s K3S_TOKEN)
  # svccontroller…enablelb: ServiceLB (the bundled Traefik's 80/443) runs on the core only, never on the AWS edge,
  # whose own Traefik holds those ports (deploy/k8s/edge). The issuer's JWKS is published by irsa/publish-oidc.sh.
  curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable K3S_TOKEN="$K3S_TOKEN" sh -s - server \
    --cluster-init \
    --node-name core \
    --node-label jeffi.io/role=core \
    --node-label jeffi.io/cloud=azure \
    --node-label svccontroller.k3s.cattle.io/enablelb=true \
    --node-ip "$TS_IP" --advertise-address "$TS_IP" "${EXTERNAL_IP_ARGS[@]}" \
    --flannel-iface tailscale0 \
    --tls-san "$TS_IP" --tls-san jeffi-k8s-core-az \
    --kube-apiserver-arg "service-account-issuer=$ISSUER" \
    --kube-apiserver-arg "service-account-jwks-uri=$ISSUER/openid/v1/jwks" \
    --etcd-snapshot-schedule-cron '0 */6 * * *' --etcd-snapshot-retention 28 \
    --write-kubeconfig-mode 0600
  unset K3S_TOKEN
fi

# Admin kubeconfig addressed to the tailnet (copy it with `tailscale ssh`; CI's KUBECONFIG_AZURE_B64 is this file).
for _ in $(seq 1 60); do [ -s /etc/rancher/k3s/k3s.yaml ] && break; sleep 5; done
umask 077
sed "s#https://127.0.0.1:6443#https://$TS_IP:6443#" /etc/rancher/k3s/k3s.yaml > /root/jeffi-azure.yaml
