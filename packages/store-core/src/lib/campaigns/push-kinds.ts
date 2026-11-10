// Client-safe: which scenarios can also send an app push, their inbox category, and the copy used
// when the admin hasn't written one. NO server imports (the editor preview reads this).

import { CAMPAIGN_WA_KINDS } from './whatsapp-kinds'

// Every scenario that can message a phone can also push.
export const CAMPAIGN_PUSH_KINDS = CAMPAIGN_WA_KINDS

export const campaignSupportsPush = (kind: string) => (CAMPAIGN_PUSH_KINDS as readonly string[]).includes(kind)

const PRICE_ALERT_KINDS = new Set(['price_drop', 'cart_price_drop', 'back_in_stock_wishlist', 'restock'])

/** Price and stock alerts sit in their own Android channel; the rest are offers. */
export const pushCategoryFor = (kind: string): 'offers' | 'price_alerts' => (PRICE_ALERT_KINDS.has(kind) ? 'price_alerts' : 'offers')

export interface PushCopy {
  title: string
  body: string
  link: string
}

// Variables: {firstName}, {items}, {productName}, {headline}, {couponCode}, {discountPercent}, {orderNumber}
// and the store's registered ones; {#if x}…{#else}…{/if} picks a part by whether x is set.
const DEFAULTS: Record<string, PushCopy> = {
  abandoned_cart: {
    title: 'Still in your cart',
    body: '{items} {#if couponCode}— use {couponCode} for {discountPercent}% off. {/if}Complete your order before it sells out.',
    link: '/cart',
  },
  back_in_stock_wishlist: { title: 'Back in stock', body: '{productName} from your wishlist is back. Grab it before it goes again.', link: '' },
  price_drop: { title: 'Price drop on your wishlist', body: '{headline}{#if couponCode} — and {couponCode} takes {discountPercent}% more off{/if}.', link: '' },
  birthday: { title: 'Happy birthday, {firstName}!', body: '{#if couponCode}A gift from us: use {couponCode} for {discountPercent}% off this week.{#else}Wishing you a wonderful day from all of us.{/if}', link: '/products' },
  review_request: { title: 'How was your order?', body: 'Tell us what you think of order {orderNumber}. It takes a minute.', link: '' },
  winback_90: { title: 'We miss you, {firstName}', body: '{#if couponCode}Come back for {discountPercent}% off with {couponCode}.{#else}See what is new in the store.{/if}', link: '/products' },
  winback_180: { title: 'It has been a while, {firstName}', body: '{#if couponCode}Here is {discountPercent}% off with {couponCode}.{#else}See what is new in the store.{/if}', link: '/products' },
  abandoned_checkout: { title: 'Your order is waiting', body: '{items} — pick up where you left off and finish your order.', link: '' },
  high_value_cart: { title: 'Your cart is saved', body: '{items} — everything is still in your cart. Complete your order when you are ready.', link: '/cart' },
  cart_price_drop: { title: 'Price drop in your cart', body: '{items} now costs less. Check out before the price changes.', link: '/cart' },
  wishlist_reminder: { title: 'Still saved for you', body: '{items} — order before stock runs out.', link: '' },
  restock: { title: 'Back in stock', body: '{productName} is back in stock. Order it before it sells out again.', link: '/wishlist' },
  viewed_product: { title: 'Still thinking it over?', body: '{items} is still available. Take another look.', link: '' },
  viewed_category: { title: 'Still browsing {items}?', body: 'Take another look at what is in {items}.', link: '' },
  replenishment: { title: 'Time to restock?', body: 'Running low on {items}? Reorder it in a tap.', link: '' },
  subscription_renewal: { title: 'Your subscription renews soon', body: '{items} is coming up for renewal. Review it before the next order.', link: '/account/subscriptions' },
  first_purchase_nudge: { title: 'A welcome gift, {firstName}', body: '{#if couponCode}Use {couponCode} for {discountPercent}% off your first order.{#else}Your first order is waiting. See what is in store.{/if}', link: '/products' },
  second_purchase_nudge: { title: 'Ready for your next order?', body: '{#if couponCode}Use {couponCode} for {discountPercent}% off.{#else}See what is new since your last order.{/if}', link: '/products' },
  signup_anniversary: { title: 'Happy anniversary, {firstName}!', body: '{#if couponCode}Thank you for shopping with us. Use {couponCode} for {discountPercent}% off.{#else}Thank you for shopping with us.{/if}', link: '/products' },
  loyalty_tier_upgrade: { title: '{headline}', body: '{#if couponCode}Celebrate with {discountPercent}% off: use {couponCode}.{#else}Enjoy your new tier benefits on your next order.{/if}', link: '/account/rewards' },
  loyalty_points_reminder: { title: '{headline}', body: '{#if couponCode}Redeem them on your next order, and {couponCode} takes {discountPercent}% more off.{#else}Redeem them on your next order.{/if}', link: '/account/rewards' },
  // The referral headline carries the share link, so the push doesn't use it.
  referral_invite: { title: 'Refer a friend, earn rewards', body: 'Share your referral link and earn points when a friend places an order.', link: '/account/referrals' },
  review_reminder: { title: 'Still time to review', body: 'Your review of order {orderNumber} helps other shoppers. It takes a minute.', link: '' },
  post_purchase: { title: 'Thanks for your order', body: 'How is everything from order {orderNumber}? Tell us what you think.', link: '' },
  review_photo_followup: { title: 'Add a photo to your review', body: 'Show other shoppers how {productName} looks. Add a photo to your review.', link: '/account/orders' },
}

/** The copy a scenario push uses: the admin's (parameters.pushTitle/pushBody/pushLink) over the default. */
export function scenarioPushCopy(kind: string, params: Record<string, unknown> | null | undefined): PushCopy {
  const d = DEFAULTS[kind] ?? { title: 'A note from us', body: '{headline}', link: '/' }
  const s = (k: string) => (typeof params?.[k] === 'string' ? String(params[k]).trim() : '')
  return { title: s('pushTitle') || d.title, body: s('pushBody') || d.body, link: s('pushLink') || d.link }
}

export const defaultPushCopy = (kind: string): PushCopy => scenarioPushCopy(kind, null)
