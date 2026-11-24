import { AD_FREE_PRICE_INR, getAdFree, type AdFreeStatus } from '@/lib/billing/ad-free'
import { getRequestedAddons } from '@/lib/billing/requested-addons'
import type { AddonId } from '@/lib/billing/addons'
import { lineBillingState, type LineBillingState } from '@controller/lib/billing/subscription'

export interface AdFreeState extends AdFreeStatus, LineBillingState {
  priceInr: number
  /** Picked during signup and not yet added or declined. */
  requested: boolean
}

/** What the Billing page and its API return for the ad-free add-on (a line on the subscription). */
export async function adFreeState(tenantId: string): Promise<AdFreeState> {
  const [status, line, requested] = await Promise.all([
    getAdFree(tenantId),
    lineBillingState(tenantId, 'ad_free'),
    getRequestedAddons(tenantId).catch(() => [] as AddonId[]),
  ])
  return { ...status, ...line, priceInr: AD_FREE_PRICE_INR, requested: requested.includes('ad_free') }
}
