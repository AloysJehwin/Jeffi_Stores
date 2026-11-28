#!/bin/bash
# Attaches the flagship Postgres data disk (jeffi-prod-pg-data, from apply.sh) to the core VM at LUN 0, then installs
# on the VM a small systemd agent (the Azure twin of jeffi-db-volume, packages/store-core/src/lib/k8s/node-user-data.ts)
# that formats a blank disk (ext4, label jeffi-pg, never one that already has a filesystem), mounts it at
# /var/lib/jeffi-pg and creates data/ (999:999, 0700). Until it is mounted the mountpoint is immutable, so nothing
# can write to the OS disk. Safe to re-run.
# Dry run by default: prints the plan. --apply attaches and installs.
# Usage: [AZ_RG=jeffi-prod-cin] bash deploy/azure/pg-disk.sh [--apply]
set -euo pipefail
RG=${AZ_RG:-jeffi-prod-cin}
VM=${AZ_CORE_VM:-jeffi-prod-core}
DISK=${AZ_PG_DISK:-jeffi-prod-pg-data}
SUBSCRIPTION=${AZ_SUBSCRIPTION:-Azure subscription 1}
APPLY=false
for a in "$@"; do case $a in --apply) APPLY=true ;; *) echo "unknown argument $a" >&2; exit 2 ;; esac; done

az account set --subscription "$SUBSCRIPTION"
az disk show -g "$RG" -n "$DISK" --query id -o tsv >/dev/null 2>&1 \
  || { echo "disk $DISK not found in $RG: run deploy/azure/apply.sh --apply first (foundation.bicep creates it)" >&2; exit 1; }
attached=$(az vm show -g "$RG" -n "$VM" --query "storageProfile.dataDisks[?name=='$DISK'].lun" -o tsv)

if ! $APPLY; then
  echo "Dry run. With --apply:"
  if [ -n "$attached" ]; then echo "  1. $DISK already attached to $VM (LUN $attached)"; else echo "  1. az vm disk attach $DISK to $VM at LUN 0, caching None"; fi
  echo "  2. az vm run-command invoke on $VM: install and start the jeffi-pg-volume agent (mkfs only a blank disk, mount /var/lib/jeffi-pg)"
  exit 0
fi

if [ -z "$attached" ]; then
  az vm disk attach -g "$RG" --vm-name "$VM" --name "$DISK" --lun 0 --caching None -o none
  echo "attached $DISK to $VM at LUN 0"
else
  echo "$DISK already attached (LUN $attached)"
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/host.sh" <<'HOST'
#!/bin/bash
set -eu
MNT=/var/lib/jeffi-pg
cat > /usr/local/sbin/jeffi-pg-volume <<'AGENT'
#!/bin/bash
MNT=/var/lib/jeffi-pg
dev() {
  for d in /dev/disk/azure/data/by-lun/0 /dev/disk/azure/scsi1/lun0; do [ -b "$d" ] && { readlink -f "$d"; return 0; }; done
  return 1
}
seal() { mountpoint -q "$MNT" || chattr +i "$MNT" 2>/dev/null || true; }
mkdir -p "$MNT"; seal
N=0
while :; do
  if mountpoint -q "$MNT"; then
    SRC=$(findmnt -n -o SOURCE "$MNT")
    if [ ! -b "$SRC" ]; then umount -l "$MNT"; seal; continue; fi
    [ $((N % 20)) -eq 0 ] && resize2fs "$SRC" >/dev/null 2>&1
    [ -d "$MNT/data" ] || { mkdir -p "$MNT/data" && chown 999:999 "$MNT/data" && chmod 0700 "$MNT/data"; }
  elif DEV=$(dev); then
    # Format only a blank disk: no filesystem and no partition table.
    if [ -z "$(blkid -p -s TYPE -o value "$DEV" 2>/dev/null)" ] && [ -z "$(blkid -p -s PTTYPE -o value "$DEV" 2>/dev/null)" ]; then
      mkfs.ext4 -q -L jeffi-pg "$DEV" || { sleep 15; continue; }
    fi
    UUID=$(blkid -s UUID -o value "$DEV")
    sed -i "\\# $MNT #d" /etc/fstab
    echo "UUID=$UUID $MNT ext4 defaults,noatime,nofail,x-systemd.device-timeout=10s 0 2" >> /etc/fstab
    systemctl daemon-reload
    mount "$MNT" || mount "$DEV" "$MNT"
  fi
  N=$((N + 1)); sleep 15
done
AGENT
chmod 755 /usr/local/sbin/jeffi-pg-volume
cat > /etc/systemd/system/jeffi-pg-volume.service <<'UNIT'
[Unit]
Description=Flagship Postgres data disk agent
After=local-fs.target
[Service]
ExecStart=/usr/local/sbin/jeffi-pg-volume
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
mkdir -p "$MNT"; mountpoint -q "$MNT" || chattr +i "$MNT"
systemctl daemon-reload
systemctl enable --now jeffi-pg-volume.service
for i in $(seq 1 30); do mountpoint -q "$MNT" && [ -d "$MNT/data" ] && break; sleep 3; done
if mountpoint -q "$MNT" && [ -d "$MNT/data" ]; then
  echo "mounted: $(findmnt -n -o SOURCE,FSTYPE,SIZE "$MNT")"
  stat -c 'data dir: %U:%G %a' "$MNT/data"
else
  echo "NOT mounted after 90s: check /dev/disk/azure/data/by-lun/0 and journalctl -u jeffi-pg-volume" >&2; exit 1
fi
HOST
az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript --scripts "@$tmp/host.sh" \
  --query 'value[0].message' -o tsv

cat <<'NEXT'

Next:
  1. Fill PG_BACKUP_CLIENT_ID in deploy/k8s/overlays/azure/azure.env (apply.sh output pgBackupClientId).
  2. Apply deploy/k8s/overlays/azure/postgres.yaml (or the platform apply) once the flagship-postgres Secret exists.
  3. bash deploy/azure/pg-init.sh (extensions, app_user, the Secret from Key Vault).
NEXT
