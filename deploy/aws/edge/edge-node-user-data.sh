#!/bin/bash
# EC2 user-data for the AWS tenant edge (AL2023 arm64, t4g.small): joins the cluster whose server is the Azure core,
# over Tailscale (flannel on tailscale0, node IP = Tailscale IP, routes accepted so the Postgres subnet and Azure DNS
# behind the core are reachable), labelled and tainted for the edge Traefik (deploy/k8s/edge). launch-edge.sh fills
# __K8S_SERVER__. The k3s token and Tailscale key come from jeffi/production/k3s through the instance profile, as on
# store nodes. No `set -x`: nothing secret reaches the console log. Idempotent on reboot.
set -euo pipefail
REGION=us-east-1
SERVER=__K8S_SERVER__
dnf install -y jq
sec() { aws secretsmanager get-secret-value --region $REGION --secret-id jeffi/production/k3s --query SecretString --output text | jq -r ".$1"; }
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
systemctl enable --now tailscaled
if ! tailscale status >/dev/null 2>&1; then
  TSKEY=$(sec TS_AUTHKEY)
  tailscale up --authkey "$TSKEY" --hostname jeffi-tenant-edge --advertise-tags tag:server-prod --accept-routes --accept-dns=false
  unset TSKEY
fi
TS_IP=
for _ in $(seq 1 30); do TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true); [ -n "$TS_IP" ] && break; sleep 2; done
[ -n "$TS_IP" ] || { echo "no Tailscale address" >&2; exit 1; }
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
if ! command -v k3s >/dev/null; then
  K3S_TOKEN=$(sec K3S_TOKEN)
  curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable K3S_URL="$SERVER" K3S_TOKEN="$K3S_TOKEN" sh -s - agent \
    --node-name tenant-edge \
    --node-label jeffi.io/edge=true --node-label jeffi.io/role=edge --node-label jeffi.io/cloud=aws \
    --node-taint jeffi.io/edge=true:NoSchedule \
    --node-ip "$TS_IP" ${PUBLIC_IP:+--node-external-ip "$PUBLIC_IP"} --flannel-iface tailscale0
  unset K3S_TOKEN
fi
