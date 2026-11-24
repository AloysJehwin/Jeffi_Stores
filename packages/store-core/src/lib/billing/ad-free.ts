import { controlPlanePool } from '@/lib/tenant-registry'
import { isFlagshipTenant } from '@/lib/payments/wallet'

// Remove-ads add-on. Every store carries the platform's AdSense ads unless its tenant has paid for the
// current period (tenants.ad_free_until). An ad_free line on the workspace's subscription; only the controller's
// billing handler writes ad_free_until (controller-service/src/lib/billing).

export const AD_FREE_PRICE_INR = 500

export interface AdFreeStatus {
  active: boolean
  until: string | null
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; adFree: boolean }>()

export async function getAdFree(tenantId: string): Promise<AdFreeStatus> {
  const r = await controlPlanePool().query(
    `SELECT ad_free_until, ad_free_until > now() AS active FROM tenants WHERE id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  return {
    active: !!row?.active,
    until: row?.ad_free_until ? new Date(row.ad_free_until).toISOString() : null,
  }
}

/**
 * Whether a store hides ads. On a control-plane error it keeps the store's last known answer, however old; with
 * none it hides ads, so a paying store never shows one.
 */
export async function storeIsAdFree(tenantId: string | null | undefined): Promise<boolean> {
  if (isFlagshipTenant(tenantId)) return false
  const hit = cache.get(tenantId!)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.adFree
  try {
    const adFree = (await getAdFree(tenantId!)).active
    cache.set(tenantId!, { at: Date.now(), adFree })
    return adFree
  } catch {
    return hit ? hit.adFree : true
  }
}
