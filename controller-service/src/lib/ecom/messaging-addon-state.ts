import {
  getMessagingAddon,
  getMessagingAddonPricing,
  invalidateMessagingEntitlement,
  messagingEntitlement,
  type MessagingAddonStatus,
  type MessagingEntitlement,
} from '@/lib/billing/messaging-addon'
import { getRequestedAddons } from '@/lib/billing/requested-addons'
import type { AddonId } from '@/lib/billing/addons'
import { lineBillingState, type LineBillingState } from '@controller/lib/billing/subscription'

export interface MessagingAddonState extends MessagingAddonStatus, LineBillingState {
  /** Monthly fee for SMS & WhatsApp together. */
  priceInr: number
  entitlement: MessagingEntitlement
  /** Picked during signup and not yet added or declined. */
  requested: boolean
}

/** What the Billing page and its API return: add-on status, price, its line on the subscription and per-channel entitlement. */
export async function messagingAddonState(tenantId: string): Promise<MessagingAddonState> {
  invalidateMessagingEntitlement(tenantId)
  const [status, line, entitlement, pricing, requested] = await Promise.all([
    getMessagingAddon(tenantId),
    lineBillingState(tenantId, 'messaging_addon', 'both'),
    messagingEntitlement(tenantId),
    getMessagingAddonPricing(),
    getRequestedAddons(tenantId).catch(() => [] as AddonId[]),
  ])
  return { ...status, ...line, priceInr: pricing.priceInr, entitlement, requested: requested.includes('messaging') }
}
