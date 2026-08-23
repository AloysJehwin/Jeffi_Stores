// cloud-init user-data that boots the multi-tenant app on a fresh pool/dedicated EC2. The AMI is
// a flagship snapshot, so /opt/jeffi-stores (checkout + compose + docker ghcr auth) is already
// present; we pull the latest image and bring the stack up. The app loads its own secrets via
// SM_SECRET_ID=jeffi/production (IAM instance profile) and resolves each tenant's RDS per-request
// from the Host header — nothing is pinned to one tenant DB. Shared by the dedicated (steps.ts)
// and pool (pool-autoscale.ts) launch paths; kept dependency-free to avoid import cycles.
export function appBootUserData(): string {
  return `#!/bin/bash
set -e
cd /opt/jeffi-stores || exit 0
SLOT=$(cat active_slot 2>/dev/null || echo green)
docker pull ghcr.io/aloysjehwin/jeffi_stores:latest || true
docker compose -f docker-compose.infra.yml -f docker-compose.\${SLOT}.yml up -d
`
}
