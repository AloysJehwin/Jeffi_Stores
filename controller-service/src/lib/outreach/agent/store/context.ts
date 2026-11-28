import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'

// The flagship store is the controller's own default pool: with no tenant context, store-core's db, site controls,
// messaging and payments all resolve to the flagship (same as the import worker's platform path). Tools run through
// here so the one place that says "flagship" is this file, and a tenant context leaking in fails loudly.
const FLAGSHIP_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export async function withFlagshipStore<T>(fn: () => Promise<T>): Promise<T> {
  const t = getCurrentTenantId()
  if (t && t !== FLAGSHIP_TENANT_ID) throw new Error('outreach store tools run in the flagship context only')
  return fn()
}
