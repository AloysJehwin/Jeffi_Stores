// cloud-init for k3s agent nodes (stock AL2023 arm64). Joins the cluster with the token in
// Secrets Manager (jeffi/production/k3s), then registers with its labels + taints.
export interface AgentNodeSpec {
  nodeName: string // pool-basic-N | t-{slug}
  labels: Record<string, string>
  taints?: string[] // key=value:Effect
  server: string // https://<core private ip>:6443
  // A store's own server: runs the database-disk agent, so the store's Postgres can live here.
  dbAgent?: boolean
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export const DB_MOUNT = '/var/lib/jeffi/db'
export const DB_READY_LABEL = 'jeffi.io/db-ready'

// The database disk arrives at /dev/sdf at launch or later (moved here from an older server), so a
// service waits for it rather than the boot script. Until it is mounted the mount point is immutable:
// nothing (a Postgres pod initialising an empty data directory) can write to the server's own disk.
// Mounted, the node labels itself jeffi.io/db-ready=true (its kubelet may label its own Node) and
// grows the filesystem after a ModifyVolume. A blank disk is formatted; one with a filesystem never is.
function dbAgentScript(nodeName: string): string {
  return `#!/bin/bash
NODE=${shq(nodeName)}
MNT=${DB_MOUNT}
kc() { timeout 20 /usr/local/bin/k3s kubectl --kubeconfig /var/lib/rancher/k3s/agent/kubelet.kubeconfig "$@"; }
dev() {
  for d in /dev/sdf /dev/xvdf; do [ -b "$d" ] && { readlink -f "$d"; return 0; }; done
  for n in /dev/nvme*n1; do
    [ -b "$n" ] || continue
    case "$(ebsnvme-id -b "$n" 2>/dev/null)" in sdf|/dev/sdf|xvdf|/dev/xvdf) echo "$n"; return 0 ;; esac
  done
  return 1
}
seal() { mountpoint -q "$MNT" || chattr +i "$MNT" 2>/dev/null || true; }
mkdir -p "$MNT"; seal
LABELLED=0; N=0
while :; do
  if mountpoint -q "$MNT"; then
    SRC=$(findmnt -n -o SOURCE "$MNT")
    if [ ! -b "$SRC" ]; then
      umount -l "$MNT"; seal; LABELLED=0
      kc label node "$NODE" ${DB_READY_LABEL}- >/dev/null 2>&1
      continue
    fi
    [ $((N % 20)) -eq 0 ] && resize2fs "$SRC" >/dev/null 2>&1
    [ "$LABELLED" = 1 ] || { kc label node "$NODE" ${DB_READY_LABEL}=true --overwrite >/dev/null 2>&1 && LABELLED=1; }
  elif DEV=$(dev); then
    if [ -z "$(blkid -p -s TYPE -o value "$DEV" 2>/dev/null)" ]; then mkfs.ext4 -q -L jeffi-db "$DEV" || { sleep 15; continue; }; fi
    UUID=$(blkid -s UUID -o value "$DEV")
    sed -i "\\# $MNT #d" /etc/fstab
    echo "UUID=$UUID $MNT ext4 defaults,noatime,nofail,x-systemd.device-timeout=10s 0 2" >> /etc/fstab
    systemctl daemon-reload
    mount "$MNT" || mount "$DEV" "$MNT"
  fi
  N=$((N + 1)); sleep 15
done
`
}

function dbAgentInstall(nodeName: string): string {
  return `mkdir -p ${DB_MOUNT} && chattr +i ${DB_MOUNT}
cat > /usr/local/sbin/jeffi-db-volume <<'AGENT'
${dbAgentScript(nodeName)}AGENT
chmod 755 /usr/local/sbin/jeffi-db-volume
cat > /etc/systemd/system/jeffi-db-volume.service <<'UNIT'
[Unit]
Description=Store database disk agent
After=local-fs.target
[Service]
ExecStart=/usr/local/sbin/jeffi-db-volume
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now jeffi-db-volume.service
`
}

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
${spec.dbAgent ? dbAgentInstall(spec.nodeName) : ''}dnf install -y jq
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
