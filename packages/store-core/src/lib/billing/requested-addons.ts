import { controlPlanePool } from '@/lib/tenant-registry'
import { isFlagshipTenant } from '@/lib/payments/wallet'
import { AD_FREE_PRICE_INR, buyAdFreeMonth, getAdFree } from '@/lib/billing/ad-free'
import { buyMessagingAddonMonth, getMessagingAddon, getMessagingAddonPricing } from '@/lib/billing/messaging-addon'
import { cleanAddonIds, type AddonId, type AddonPrice } from '@/lib/billing/addons'

// Add-ons picked in the onboarding plan step (tenants.requested_addons). Nothing is charged at signup:
// once the store is live each one is bought from the wallet with the usual buy functions, whose debits
// are keyed per period. A short wallet leaves the request pending: it is retried on each wallet top-up,
// or the owner buys it in Billing. A request is removed when bought or declined.

export async function addonPrices(): Promise<AddonPrice[]> {
  const messaging = await getMessagingAddonPricing()
  return [
    { id: 'messaging', priceInr: messaging.priceInr },
    { id: 'ad_free', priceInr: AD_FREE_PRICE_INR },
  ]
}

export async function getRequestedAddons(tenantId: string): Promise<AddonId[]> {
  const r = await controlPlanePool().query(`SELECT requested_addons FROM tenants WHERE id = $1`, [tenantId])
  return cleanAddonIds(r.rows[0]?.requested_addons)
}

export async function setRequestedAddons(tenantId: string, ids: readonly AddonId[]): Promise<void> {
  await controlPlanePool().query(`UPDATE tenants SET requested_addons = $2::text[], updated_at = now() WHERE id = $1`, [
    tenantId,
    cleanAddonIds(ids),
  ])
}

export async function clearRequestedAddon(tenantId: string, id: AddonId): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenants SET requested_addons = array_remove(requested_addons, $2), updated_at = now()
      WHERE id = $1 AND $2 = ANY(requested_addons)`,
    [tenantId, id]
  )
}

async function buyRequested(tenantId: string, id: AddonId): Promise<{ ok: boolean; error?: string }> {
  if (id === 'messaging') {
    // Already covering both channels: don't stack a second month.
    const cur = await getMessagingAddon(tenantId)
    if (cur.active && cur.tier === 'both') return { ok: true }
    return buyMessagingAddonMonth(tenantId, { tier: 'both', renew: true, reason: 'purchase' })
  }
  if ((await getAdFree(tenantId)).active) return { ok: true }
  return buyAdFreeMonth(tenantId, { renew: true, reason: 'purchase' })
}

export interface AddonActivation {
  bought: AddonId[]
  pending: { id: AddonId; error: string }[]
}

/**
 * Buy what a live store's owner asked for at signup. Never throws; safe to call again: an add-on that
 * is already active is only cleared, and a period's wallet debit is charged once.
 */
export async function activateRequestedAddons(tenantId: string): Promise<AddonActivation> {
  const out: AddonActivation = { bought: [], pending: [] }
  if (isFlagshipTenant(tenantId)) return out
  let requested: AddonId[] = []
  try {
    const r = await controlPlanePool().query(`SELECT requested_addons, status FROM tenants WHERE id = $1`, [tenantId])
    if (r.rows[0]?.status !== 'active') return out
    requested = cleanAddonIds(r.rows[0].requested_addons)
  } catch (e: any) {
    console.warn('[requested-addons] could not read requests', tenantId, e?.message || e)
    return out
  }
  for (const id of requested) {
    try {
      const r = await buyRequested(tenantId, id)
      if (r.ok) {
        await clearRequestedAddon(tenantId, id)
        out.bought.push(id)
      } else out.pending.push({ id, error: r.error || 'not bought' })
    } catch (e: any) {
      out.pending.push({ id, error: String(e?.message || e) })
    }
  }
  if (out.pending.length) console.warn('[requested-addons] left pending', tenantId, out.pending)
  return out
}
