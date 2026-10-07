#!/bin/bash
# EC2 user-data for the k3s core node (t4g.large, AL2023 arm64). Idempotent on reboot.
# Needs the instance profile jeffi-stores-ec2-profile (Secrets Manager read, Route53, S3 etcd bucket).
set -euxo pipefail
REGION=us-east-1
SECRET=jeffi/production/k3s
dnf install -y jq
sec() { aws secretsmanager get-secret-value --region $REGION --secret-id $SECRET --query SecretString --output text | jq -r ".$1"; }

# Tailscale: reach the Razer (AI gateway, Coroot agents) and let CI talk to the API privately.
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled
TSKEY=$(sec TS_AUTHKEY)
[ -z "$TSKEY" ] || tailscale status >/dev/null 2>&1 || tailscale up --authkey "$TSKEY" --hostname jeffi-k8s-core

TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/public-ipv4)

if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable K3S_TOKEN="$(sec K3S_TOKEN)" sh -s - server \
    --cluster-init \
    --node-name core \
    --node-label jeffi.io/role=core \
    ${TS_IP:+--tls-san "$TS_IP"} --tls-san "$PUBLIC_IP" \
    --etcd-snapshot-schedule-cron '0 */6 * * *' --etcd-snapshot-retention 28 \
    --kubelet-arg=max-pods=60 \
    --write-kubeconfig-mode 0600
fi
