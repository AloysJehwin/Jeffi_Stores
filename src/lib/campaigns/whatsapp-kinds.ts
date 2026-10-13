// Client-safe: which campaign kinds support WhatsApp. NO server imports here
// (no @/lib/shared/db) so client components can import it without pulling server code
// into the browser bundle.

export const CAMPAIGN_WA_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'restock',
  'winback_90',
  'winback_180',
  'price_drop',
  'viewed_product',
  'viewed_category',
  'high_value_cart',
  'cart_price_drop',
  'wishlist_reminder',
  'review_photo_followup',
  'back_in_stock_wishlist',
  'first_purchase_nudge',
  'second_purchase_nudge',
  'signup_anniversary',
  'replenishment',
  'subscription_renewal',
  'loyalty_tier_upgrade',
  'loyalty_points_reminder',
  'referral_invite',
  'birthday',
  'review_request',
  'review_reminder',
  'post_purchase',
] as const

export function campaignSupportsWhatsApp(kind: string): boolean {
  return (CAMPAIGN_WA_KINDS as readonly string[]).includes(kind)
}

// What each slot of the standard WhatsApp templates should hold (the `_action` variants share their base's).
const WA_SLOT_DEFAULTS: Record<string, Record<string, string>> = {
  'cart/abandoned': { '1': '{items}' },
  restock: { '1': '{productName}' },
  'promo/offer': { '1': '{headline}', '2': '{couponCode}', '3': '{discountPercent}' },
  'feedback/request': { '1': '{orderNumber}', '2': '{ctaUrl}' },
}
export const waSlotDefaults = (slug: string | null | undefined): Record<string, string> =>
  (slug && WA_SLOT_DEFAULTS[slug.replace(/_action$/, '')]) || {}
