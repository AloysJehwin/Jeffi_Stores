// cloud-init for k3s agent nodes (stock AL2023 arm64). Joins the cluster with the token in
// Secrets Manager (jeffi/production/k3s), then registers with its labels + taints.
export interface AgentNodeSpec {
  nodeName: string // pool-basic-N | t-{slug}
  labels: Record<string, string>
  taints?: string[] // key=value:Effect
  server: string // https://<core private ip>:6443
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function agentNodeUserData(spec: AgentNodeSpec): string {
  const args = [
    'agent',
    '--node-name',
    spec.nodeName,
    ...Object.entries(spec.labels).flatMap(([k, v]) => ['--node-label', `${k}=${v}`]),
    ...(spec.taints ?? []).flatMap(t => ['--node-taint', t]),
  ]
    .map(shq)
    .join(' ')
  return `#!/bin/bash
set -euxo pipefail
REGION=us-east-1
dnf install -y jq
sec() { aws secretsmanager get-secret-value --region $REGION --secret-id jeffi/production/k3s --query SecretString --output text | jq -r ".$1"; }
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
systemctl enable --now tailscaled
TSKEY=$(sec TS_AUTHKEY)
[ -z "$TSKEY" ] || tailscale status >/dev/null 2>&1 || tailscale up --authkey "$TSKEY" --hostname ${shq(`jeffi-${spec.nodeName}`)} --advertise-tags tag:server-prod
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL=stable K3S_URL=${shq(spec.server)} K3S_TOKEN="$(sec K3S_TOKEN)" sh -s - ${args}
fi
`
}
