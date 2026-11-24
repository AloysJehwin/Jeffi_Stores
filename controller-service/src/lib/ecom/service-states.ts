import { listServiceApprovals } from '@/lib/tenant-registry/service-approvals'
import { loadKybView } from '@controller/lib/kyb/view'

export type ApiService = 'messaging' | 'documents'
export type ServiceState = { status: 'off' | 'live' | 'pending' | 'rejected'; note?: string | null }

/**
 * Where each API service stands for a workspace: not added, waiting for approval, rejected or live. A request Jeffi
 * hasn't approved (in review or turned down) shows as such whether or not the service is on the workspace yet.
 */
export async function serviceStates(tenant: { id: string; service_types?: string[] | null }): Promise<Record<ApiService, ServiceState>> {
  const approvals = await listServiceApprovals(tenant.id).catch(() => [])
  const state = (s: ApiService): ServiceState => {
    const a = approvals.find(x => x.service === s)
    if (a && a.status !== 'approved') return { status: a.status, note: a.note }
    return { status: (tenant.service_types ?? []).includes(s) ? 'live' : 'off' }
  }
  return { messaging: state('messaging'), documents: state('documents') }
}

/** Of these services, the ones whose business verification still needs the owner: Jeffi can't approve them until it's done. */
export async function kybUnready(tenant: { id: string; service_types: string[] | null }, ownerId: string, services: ApiService[]): Promise<ApiService[]> {
  if (!services.length) return []
  const kyb = await loadKybView(tenant, ownerId).catch(() => null)
  return kyb ? services.filter(s => !kyb.services[s].ready) : []
}
