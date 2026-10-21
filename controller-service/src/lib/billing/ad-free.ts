import { controlPlanePool } from '@/lib/tenant-registry'
import { debitWallet, isFlagshipTenant } from '@/lib/payments/wallet'

// Remove-ads add-on. Every store carries the platform's AdSense ads unless its tenant has paid for the
// current month (tenants.ad_free_until). Paid from the prepaid wallet, whose top-ups already carry GST.
// The charge for a period is keyed on its start date, so a double click or a cron retry charges once.

export const AD_FREE_PRICE_INR = 500

export interface AdFreeStatus {
  active: boolean
  until: string | null
  renew: boolean
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; adFree: boolean }>()

export async function getAdFree(tenantId: string): Promise<AdFreeStatus> {
  const r = await controlPlanePool().query(
    `SELECT ad_free_until, ad_free_renew, ad_free_until > now() AS active FROM tenants WHERE id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  return {
    active: !!row?.active,
    until: row?.ad_free_until ? new Date(row.ad_free_until).toISOString() : null,
    renew: !!row?.ad_free_renew,
  }
}

/** Whether a store hides ads. Fails open to showing ads when the control plane can't be read. */
export async function storeIsAdFree(tenantId: string | null | undefined): Promise<boolean> {
  if (isFlagshipTenant(tenantId)) return false
  const hit = cache.get(tenantId!)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.adFree
  const adFree = await getAdFree(tenantId!)
    .then(s => s.active)
    .catch(() => false)
  cache.set(tenantId!, { at: Date.now(), adFree })
  return adFree
}

/**
 * Charge one month and extend ad_free_until from whichever is later, now or the current end. With
 * renew, the daily cron keeps charging; without it the period simply runs out.
 */
export async function buyAdFreeMonth(
  tenantId: string,
  opts: { renew: boolean; reason: 'purchase' | 'renewal' }
): Promise<{ ok: true; status: AdFreeStatus; charged: boolean } | { ok: false; error: string }> {
  if (isFlagshipTenant(tenantId)) return { ok: false, error: 'The platform store has no ad-free add-on.' }
  const current = await getAdFree(tenantId)
  const start = current.active && current.until ? new Date(current.until) : new Date()
  const periodKey = start.toISOString().slice(0, 10)
  const res = await debitWallet({
    tenantId,
    amountInr: AD_FREE_PRICE_INR,
    category: 'ad_free',
    externalRef: `ad_free:${tenantId}:${periodKey}`,
    note: `Remove ads, month from ${periodKey}${opts.reason === 'renewal' ? ' (auto-renew)' : ''}`,
    floorInr: 0,
    onCharged: async client => {
      await client.query(
        `UPDATE tenants SET ad_free_until = $2::timestamptz + interval '1 month', ad_free_renew = $3, updated_at = now()
          WHERE id = $1`,
        [tenantId, start.toISOString(), opts.renew]
      )
    },
  })
  if (!res.ok) return res
  if (!res.charged) await setAdFreeRenew(tenantId, opts.renew)
  cache.delete(tenantId)
  return { ok: true, charged: res.charged, status: await getAdFree(tenantId) }
}

export async function setAdFreeRenew(tenantId: string, renew: boolean): Promise<void> {
  await controlPlanePool().query(`UPDATE tenants SET ad_free_renew = $2, updated_at = now() WHERE id = $1`, [
    tenantId,
    renew,
  ])
}

/** Auto-renewing tenants whose month ends within a day, or lapsed under a week ago (wallet was short). */
export async function tenantsDueForAdFreeRenewal(): Promise<string[]> {
  const r = await controlPlanePool().query(
    `SELECT id FROM tenants
      WHERE ad_free_renew AND status = 'active' AND ad_free_until IS NOT NULL
        AND ad_free_until < now() + interval '1 day' AND ad_free_until > now() - interval '7 days'`
  )
  return r.rows.map(row => row.id as string)
}
