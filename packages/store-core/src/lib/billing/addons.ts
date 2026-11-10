// The store add-ons an owner can pick while signing up. Client-safe: ids and copy only.
// Prices are live values (messaging: getMessagingAddonPricing; ad-free: AD_FREE_PRICE_INR).

export const ADDON_IDS = ['messaging', 'ad_free'] as const
export type AddonId = (typeof ADDON_IDS)[number]

export const ADDON_INFO: Record<AddonId, { name: string; benefit: string }> = {
  messaging: {
    name: 'SMS & WhatsApp',
    benefit: 'Send OTPs, order updates and campaigns by SMS and WhatsApp from your own numbers.',
  },
  ad_free: {
    name: 'Ad-free store',
    benefit: 'Remove the Google ads that every store shows by default.',
  },
}

export const isAddonId = (v: unknown): v is AddonId => (ADDON_IDS as readonly unknown[]).includes(v)

/** Known ids only, de-duplicated, in catalogue order. */
export const cleanAddonIds = (v: unknown): AddonId[] =>
  Array.isArray(v) ? ADDON_IDS.filter(id => v.includes(id)) : []

export interface AddonPrice {
  id: AddonId
  priceInr: number
}
