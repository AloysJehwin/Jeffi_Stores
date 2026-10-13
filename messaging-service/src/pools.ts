import { lookupTenantContextById, tenantPool } from '@jeffi/tenancy'
import { db } from './db.js'
import { PLATFORM_TENANT_ID, type Pools } from './templates-v2.js'

// pool = where this tenant's own rows live (its DB); pools.platform = flagship DB with the
// platform defaults + control plane. The platform tenant has no tenant_infra → flagship for both.
export async function poolsForTenant(tenantId: string) {
  if (tenantId === PLATFORM_TENANT_ID) return { ctx: null, pool: db, pools: { tenant: db, platform: db } as Pools }
  const ctx = await lookupTenantContextById(tenantId)
  if (!ctx) throw Object.assign(new Error('Tenant not found'), { status: 404 })
  const pool = tenantPool(ctx)
  return { ctx, pool, pools: { tenant: pool, platform: db } as Pools }
}
