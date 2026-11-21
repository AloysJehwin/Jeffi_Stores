import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ITEM_LABEL, SERVICE_LABEL, type KybItem, type KybService } from './requirements'
import { loadKybView } from './view'

// The KYB gate in front of a service: the owner can't request Messaging or Documents, and Jeffi can't approve them,
// until everything that service needs is in (documents may still be waiting for a reviewer).

export interface GateMiss {
  item: KybItem
  label: string
  problem?: string
}

export type GateResult = { ok: true } | { ok: false; message: string; missing: Partial<Record<KybService, GateMiss[]>> }

export async function tenantOwnerId(tenantId: string): Promise<string | null> {
  const r = await controlPlanePool().query<{ owner_id: string }>(`SELECT owner_id FROM owner_tenants WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenantId])
  return r.rows[0]?.owner_id ?? null
}

export async function kybGate(tenant: { id: string; service_types: string[] | null }, ownerId: string | null, services: KybService[]): Promise<GateResult> {
  const view = await loadKybView(tenant, ownerId ?? '00000000-0000-0000-0000-000000000000')
  const missing: Partial<Record<KybService, GateMiss[]>> = {}
  for (const s of services) {
    const st = view.services[s]
    if (!st || st.ready) continue
    missing[s] = st.todo.map(item => ({ item, label: ITEM_LABEL[item], problem: view.items[item].problem }))
  }
  const blocked = Object.keys(missing) as KybService[]
  if (!blocked.length) return { ok: true }
  const first = missing[blocked[0]]![0]
  return {
    ok: false,
    message: `Verify your business first. ${SERVICE_LABEL[blocked[0]]} needs: ${missing[blocked[0]]!.map(m => m.label).join(', ')}.${first?.problem ? ` ${first.problem}` : ''}`,
    missing,
  }
}
