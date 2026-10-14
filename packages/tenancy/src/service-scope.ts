import { controlPlanePool, PLATFORM_TENANT_ID } from './pools'

// A service pod either belongs to one store tenant (SERVICE_TENANT_SLUG) or is the platform's.
// In k8s every store tenant runs its own services, so the platform's pods skip store tenants
// (SERVICE_SKIP_STORE_TENANTS=true); locally one set of services handles everyone.
export interface ServiceScope {
  tenantId: string | null
  skipStoreTenants: boolean
}

export async function resolveServiceScope(): Promise<ServiceScope> {
  const slug = process.env.SERVICE_TENANT_SLUG?.trim()
  if (!slug) return { tenantId: null, skipStoreTenants: process.env.SERVICE_SKIP_STORE_TENANTS === 'true' }
  // Not the registry lookup: the pods start before provisioning marks the tenant active.
  const r = await controlPlanePool().query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug])
  if (!r.rows[0]) throw new Error(`SERVICE_TENANT_SLUG "${slug}" is not a tenant`)
  return { tenantId: r.rows[0].id, skipStoreTenants: false }
}

/** WHERE fragment limiting a tenant_id column to this pod's tenants; `p` is the next free $ index. */
export function scopeSql(scope: ServiceScope, col: string, p: number): { sql: string; params: unknown[] } {
  if (scope.tenantId) return { sql: `${col} = $${p}`, params: [scope.tenantId] }
  if (scope.skipStoreTenants) {
    // The platform's own rows stay here: its control-plane row reads as a store (service_types defaults to {store}).
    return {
      sql: `(${col} = '${PLATFORM_TENANT_ID}' OR NOT EXISTS (SELECT 1 FROM tenants st WHERE st.id = ${col} AND 'store' = ANY(st.service_types)))`,
      params: [],
    }
  }
  return { sql: 'true', params: [] }
}

export function inScope(scope: ServiceScope, tenantId: string | null | undefined): boolean {
  return !scope.tenantId || tenantId === scope.tenantId
}
