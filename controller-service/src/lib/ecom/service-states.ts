import { listServiceApprovals } from '@/lib/tenant-registry/service-approvals'

export type ApiService = 'messaging' | 'documents'
export type ServiceState = { status: 'off' | 'live' | 'pending' | 'rejected'; note?: string | null }

/** Where each API service stands for a workspace: not added, waiting for approval, rejected or live. */
export async function serviceStates(tenant: { id: string; service_types?: string[] | null }): Promise<Record<ApiService, ServiceState>> {
  const approvals = await listServiceApprovals(tenant.id).catch(() => [])
  const state = (s: ApiService): ServiceState => {
    if (!(tenant.service_types ?? []).includes(s)) return { status: 'off' }
    const a = approvals.find(x => x.service === s)
    return a && a.status !== 'approved' ? { status: a.status, note: a.note } : { status: 'live' }
  }
  return { messaging: state('messaging'), documents: state('documents') }
}
