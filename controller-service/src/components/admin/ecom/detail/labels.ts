import type { ComputeSpec } from '@/lib/compute/spec'

/** "Messaging + Documents" for a workspace's API services. */
export const apiServices = (t: { service_types?: string[] | null }) =>
  (t.service_types ?? []).filter(s => s !== 'store').map(s => (s === 'messaging' ? 'Messaging' : 'Documents')).join(' + ') || 'no services'

export type DetailSection = 'store' | 'instance' | 'status' | 'billing'

type InfraFields = { status: string; instance_state: string; rds_endpoint: string | null; ec2_target: string | null; ec2_instance_id?: string | null }

/** It has a database, a server or a serving address: a build got that far and was not rolled back. */
export const isDeployed = (t: Pick<InfraFields, 'rds_endpoint' | 'ec2_target' | 'ec2_instance_id'>) => !!(t.rds_endpoint || t.ec2_target || t.ec2_instance_id)

/**
 * The instance as it stands. tenants.instance_state starts as 'running' before anything exists, so it only counts
 * once the store is deployed.
 */
export function instanceStateLabel(t: InfraFields, job: { status: string } | null): string {
  if (t.status === 'terminated') return 'Removed'
  if (job?.status === 'pending' || job?.status === 'running') return 'Being built'
  if (job?.status === 'failed' && t.status !== 'active') return isDeployed(t) ? 'Build failed' : 'Not deployed (build failed)'
  if (!isDeployed(t)) return 'Not deployed yet'
  return t.instance_state.charAt(0).toUpperCase() + t.instance_state.slice(1).replace(/_/g, ' ')
}

/** Where the spec puts the store: "Own server · t4g.medium", "Own servers · t4g.large × 2" or "Shared pool". */
export function placementLabel(spec: Pick<ComputeSpec, 'node'> | null | undefined): string {
  if (!spec) return '—'
  const { placement, type, count } = spec.node
  if (placement === 'pool') return 'Shared pool'
  return `Own server${count > 1 ? 's' : ''}${type ? ` · ${type}${count > 1 ? ` × ${count}` : ''}` : ''}`
}

/** Where a store with nothing running will run: "Planned: own server · t4g.medium"; null for a removed one or no spec. */
export const plannedPlacement = (t: Pick<InfraFields, 'status'>, spec: Pick<ComputeSpec, 'node'> | null | undefined) =>
  t.status === 'terminated' || !spec ? null : `Planned: ${placementLabel(spec).toLowerCase()}`

/** "Not deployed yet. Planned: own server · t4g.medium." */
export function notDeployedNote(t: InfraFields, job: { status: string } | null, spec: Pick<ComputeSpec, 'node'> | null | undefined): string {
  const planned = plannedPlacement(t, spec)
  return `${instanceStateLabel(t, job)}.${planned ? ` ${planned}.` : ''}`
}
