import { AD_FREE_PRICE_INR, getAdFree, type AdFreeStatus } from '@/lib/billing/ad-free'
import { getWalletBalance } from '@/lib/payments/wallet'
import { getRequestedAddons } from '@/lib/billing/requested-addons'
import type { AddonId } from '@/lib/billing/addons'

export interface AdFreeState extends AdFreeStatus {
  priceInr: number
  balanceInr: number
  /** Picked during signup and not yet bought or declined. */
  requested: boolean
}

/** What the Billing page and its API return for the ad-free add-on. */
export async function adFreeState(tenantId: string): Promise<AdFreeState> {
  const [status, balance, requested] = await Promise.all([
    getAdFree(tenantId),
    getWalletBalance(tenantId),
    getRequestedAddons(tenantId).catch(() => [] as AddonId[]),
  ])
  return { ...status, priceInr: AD_FREE_PRICE_INR, balanceInr: balance.balance, requested: requested.includes('ad_free') }
}
