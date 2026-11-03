// Client-safe: which scenarios can also send an app push, their inbox category, and the copy used
// when the admin hasn't written one. NO server imports (the editor preview reads this).

export const CAMPAIGN_PUSH_KINDS = [
  'abandoned_cart',
  'back_in_stock_wishlist',
  'price_drop',
  'birthday',
  'review_request',
  'winback_90',
  'winback_180',
] as const

export const campaignSupportsPush = (kind: string) => (CAMPAIGN_PUSH_KINDS as readonly string[]).includes(kind)

/** Wishlist price and stock alerts sit in their own Android channel; the rest are offers. */
export const pushCategoryFor = (kind: string): 'offers' | 'price_alerts' =>
  kind === 'price_drop' || kind === 'back_in_stock_wishlist' ? 'price_alerts' : 'offers'

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
}

/** The copy a scenario push uses: the admin's (parameters.pushTitle/pushBody/pushLink) over the default. */
export function scenarioPushCopy(kind: string, params: Record<string, unknown> | null | undefined): PushCopy {
  const d = DEFAULTS[kind] ?? { title: 'A note from us', body: '{headline}', link: '/' }
  const s = (k: string) => (typeof params?.[k] === 'string' ? String(params[k]).trim() : '')
  return { title: s('pushTitle') || d.title, body: s('pushBody') || d.body, link: s('pushLink') || d.link }
}

export const defaultPushCopy = (kind: string): PushCopy => scenarioPushCopy(kind, null)
