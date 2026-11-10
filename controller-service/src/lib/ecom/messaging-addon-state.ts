import {
  getMessagingAddon,
  getMessagingAddonPricing,
  invalidateMessagingEntitlement,
  messagingEntitlement,
  type MessagingAddonStatus,
  type MessagingEntitlement,
} from '@/lib/billing/messaging-addon'
import { getWalletBalance } from '@/lib/payments/wallet'
import { getRequestedAddons } from '@/lib/billing/requested-addons'
import type { AddonId } from '@/lib/billing/addons'

export interface MessagingAddonState extends MessagingAddonStatus {
  /** Monthly fee for SMS & WhatsApp together. */
  priceInr: number
  balanceInr: number
  entitlement: MessagingEntitlement
  /** Picked during signup and not yet bought or declined. */
  requested: boolean
}

/** What the Billing page and its API return: add-on status, prices, wallet balance and per-channel entitlement. */
export async function messagingAddonState(tenantId: string): Promise<MessagingAddonState> {
  invalidateMessagingEntitlement(tenantId)
  const [status, balance, entitlement, pricing, requested] = await Promise.all([
    getMessagingAddon(tenantId),
    getWalletBalance(tenantId),
    messagingEntitlement(tenantId),
    getMessagingAddonPricing(),
    getRequestedAddons(tenantId).catch(() => [] as AddonId[]),
  ])
  return { ...status, priceInr: pricing.priceInr, balanceInr: balance.balance, entitlement, requested: requested.includes('messaging') }
}
