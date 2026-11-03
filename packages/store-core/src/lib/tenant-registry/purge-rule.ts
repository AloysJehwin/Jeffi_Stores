// Who may be hard-deleted (purgeTenant). Pure, so client components can show/hide Delete with the same rule.

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

// 'suspended' = a provisioning run that rolled back (or a store whose DB is gone).
const PURGEABLE_STATUSES = new Set(['terminated', 'rejected', 'suspended'])

export interface PurgeCandidate {
  id: string
  status: string
  rds_endpoint?: string | null
  ec2_instance_id?: string | null
}

/**
 * Why a store cannot be hard-deleted yet, or null when it can: terminated, rejected or rolled back
 * (suspended), with no database and no servers left. `servers` = its live servers, when the caller knows them.
 */
export function purgeBlocker(t: PurgeCandidate, servers = 0): string | null {
  if (t.id === PLATFORM_TENANT_ID) return 'The platform cannot be deleted'
  if (!PURGEABLE_STATUSES.has(t.status)) return 'Only a terminated, rejected or rolled-back store can be deleted'
  if (t.rds_endpoint) return 'Its database still exists; deprovision it first'
  if (t.ec2_instance_id || servers > 0) return 'Its servers are still running; deprovision it first'
  return null
}
