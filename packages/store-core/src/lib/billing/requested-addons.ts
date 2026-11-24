import { controlPlanePool } from '@/lib/tenant-registry'
import { isFlagshipTenant } from '@/lib/payments/wallet'
import { AD_FREE_PRICE_INR } from '@/lib/billing/ad-free'
import { getMessagingAddonPricing } from '@/lib/billing/messaging-addon'
import { cleanAddonIds, type AddonId, type AddonPrice } from '@/lib/billing/addons'

// Add-ons picked in the onboarding plan step (tenants.requested_addons). Nothing is charged at signup: a
// Mandatory store's requests go into its first subscription at KYC approval (controller lib/billing
// startStoreSubscription clears them); an Optional store's stay requested until the owner adds or declines them
// in Billing.

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

export interface AddonActivation {
  bought: AddonId[]
  pending: { id: AddonId; error: string }[]
}

/**
 * Called when a store goes live (provisioning). Add-ons are subscription lines now, so nothing is bought from the
 * wallet: whatever is still requested is reported pending for the owner to add in Billing. Never throws.
 */
export async function activateRequestedAddons(tenantId: string): Promise<AddonActivation> {
  const out: AddonActivation = { bought: [], pending: [] }
  if (isFlagshipTenant(tenantId)) return out
  const requested = await getRequestedAddons(tenantId).catch(() => [] as AddonId[])
  out.pending = requested.map(id => ({ id, error: 'add it to the subscription in Billing' }))
  return out
}
