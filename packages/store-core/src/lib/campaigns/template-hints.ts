// Which library templates suit which campaign kind — drives the "Recommended" group in template
// pickers. Client-safe. The exact match is always the campaign's own imported template
// (campaign/<kind>); hints add related standard templates. A hint ending in '/' matches by prefix.

type Channel = 'email' | 'sms' | 'whatsapp'

/** Old campaign WhatsApp registry keys → the approved library templates they correspond to. */
export const LEGACY_WA_KEY_TO_SLUG: Record<string, string> = {
  abandoned_cart: 'cart/abandoned',
  promo_offer: 'promo/offer',
  back_in_stock: 'restock',
  new_arrivals: 'promo/new-arrivals',
  reorder_reminder: 'promo/reorder',
  festive_greeting: 'promo/festive',
  feedback_request: 'feedback/request',
}

const CART = ['cart/']
const PROMO = ['promo/offer', 'winback']
const HINTS: Record<string, string[]> = {
  abandoned_cart: CART, abandoned_checkout: CART, high_value_cart: CART, cart_price_drop: ['price-drop', ...CART],
  viewed_product: ['restock', 'price-drop'], viewed_category: ['promo/new-arrivals'],
  wishlist_reminder: ['wishlist/', 'price-drop'], back_in_stock_wishlist: ['restock'], restock: ['restock'],
  price_drop: ['price-drop', 'wishlist/price-drop'],
  post_purchase: ['review/', 'feedback/request', 'promo/reorder'],
  review_request: ['review/', 'feedback/request'], review_reminder: ['review/', 'feedback/request'],
  review_photo_followup: ['review/', 'feedback/request'],
  winback_90: PROMO, winback_180: PROMO, first_purchase_nudge: PROMO, second_purchase_nudge: [...PROMO, 'promo/bundle'],
  signup_anniversary: ['anniversary', 'promo/festive'], birthday: ['birthday', 'promo/festive'], birthday_collect: ['birthday'],
  replenishment: ['promo/reorder'], subscription_renewal: ['promo/reorder'],
  loyalty_tier_upgrade: ['loyalty/', 'promo/vip-tier'], loyalty_points_reminder: ['loyalty/'],
  referral_invite: ['referral/'],
  messaging: ['messaging/', 'promo/', 'starter/'],
}

// Approved WhatsApp templates that suit each kind.
const WA_HINTS: Record<string, string[]> = {
  'cart/abandoned': ['abandoned_cart', 'abandoned_checkout', 'high_value_cart', 'cart_price_drop'],
  'promo/offer': ['winback_90', 'winback_180', 'first_purchase_nudge', 'second_purchase_nudge', 'signup_anniversary', 'loyalty_tier_upgrade', 'loyalty_points_reminder'],
  restock: ['restock', 'back_in_stock_wishlist', 'price_drop', 'wishlist_reminder', 'viewed_product'],
  'promo/new-arrivals': ['viewed_category', 'replenishment'],
  'promo/reorder': ['replenishment', 'subscription_renewal', 'post_purchase'],
  'promo/festive': ['birthday', 'signup_anniversary'],
  'feedback/request': ['review_request', 'review_reminder', 'review_photo_followup', 'post_purchase'],
}
const waHints = (kind: string) => Object.keys(WA_HINTS).filter(slug => WA_HINTS[slug].includes(kind))

/** 0 = not recommended; higher = better fit (exact campaign template first). */
export function recommendScore(kind: string | null | undefined, channel: Channel, slug: string): number {
  if (!kind) return 0
  if (slug === `campaign/${kind}`) return 3
  const hints = [...(HINTS[kind] ?? []), ...(channel === 'whatsapp' ? waHints(kind) : [])]
  if (hints.includes(slug)) return 2
  if (hints.some(h => h.endsWith('/') && slug.startsWith(h))) return 1
  return 0
}

/** Library templates a built-in campaign kind links to by default (see scripts/import-campaign-templates.ts). */
export function defaultCampaignSlugs(kind: string): { email: string | null; sms: string | null } {
  return {
    email: kind === 'review_request' ? null : `campaign/${kind}`, // review_request keeps its AMP renderer
    sms: kind === 'birthday_collect' ? null : `campaign/${kind}`,
  }
}
