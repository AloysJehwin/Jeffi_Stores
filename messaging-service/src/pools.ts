import { lookupTenantContextById, tenantPool } from '@jeffi/tenancy'
import { db } from './db.js'
import { PLATFORM_TENANT_ID, type Pools } from './templates-v2.js'

// pool = where this tenant's own rows live (its DB); pools.platform = flagship DB with the
// platform defaults + control plane. The platform tenant and API-only tenants have no tenant DB → flagship.
export async function poolsForTenant(tenantId: string) {
  if (tenantId === PLATFORM_TENANT_ID) return { ctx: null, pool: db, pools: { tenant: db, platform: db } as Pools }
  const ctx = await lookupTenantContextById(tenantId)
  // Messaging/documents-only workspaces have no store DB: their rows live in the main DB by tenant_id.
  const pool = ctx?.infra?.rdsEndpoint ? tenantPool(ctx) : db
  return { ctx, pool, pools: { tenant: pool, platform: db } as Pools }
}
