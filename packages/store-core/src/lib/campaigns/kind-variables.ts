// The variables each campaign kind fills at send time, and which of them its message must use.
// Client-safe; drives the editor's variable list and the "required variable" checks.

import { SINGLE_PRODUCT_KINDS, MULTI_PRODUCT_KINDS } from '@/lib/campaigns/template-validation'

type Channel = 'email' | 'sms' | 'whatsapp'
export type KindVariable = { key: string; label: string; description: string; sample: string; required: boolean }

const DEFS: Record<string, [label: string, description: string, sample: string]> = {
  firstName: ['First name', "Recipient's first name", 'Priya'],
  ctaUrl: ['Button link', 'Where the call-to-action goes (cart, product, store…)', 'https://…'],
  couponCode: ['Coupon code', 'Attached coupon code', 'BACK-AB12CD'],
  discountPercent: ['Discount %', 'Coupon discount percentage', '10'],
  itemsHtml: ['Product gallery', 'Block: product rows with thumbnails', 'table'],
  cartItems: ['Item names', 'Item names as plain text', 'Drill, Bolts'],
  items: ['Item names', 'Item names as plain text', 'Drill, Bolts'],
  itemCount: ['Item count', 'Number of items', '2'],
  orderNumber: ['Order number', 'Order reference', 'TEST-12345'],
  total: ['Total', 'Order/cart total', '2200.00'],
  productCard: ['Product card', 'Block: product image + name + price', 'card'],
  productName: ['Product name', 'Featured product name', 'Sample Product'],
  productImageUrl: ['Product image URL', 'Use inside an image src', 'https://…'],
  oldPrice: ['Old price', 'Price before the drop', '999'],
  newPrice: ['New price', 'Current price', '799'],
  categoryName: ['Category', 'The category they browsed', 'Power tools'],
  points: ['Points', 'Loyalty points balance', '1200'],
  pointsWorth: ['Points value', 'What the points are worth', '₹120'],
  tier: ['Tier', 'Loyalty tier', 'Gold'],
  referralCode: ['Referral code', "The customer's referral code", 'PRIYA10'],
  rewardPoints: ['Reward points', 'Points earned per referral', '500'],
  shareUrl: ['Share link', "The customer's referral link", 'https://…'],
  headline: ['Headline', 'Short offer line', 'A special offer for you'],
}

const OFFER = ['firstName', 'ctaUrl', 'couponCode', 'discountPercent']
const CART = [...OFFER, 'itemsHtml', 'cartItems', 'itemCount']
const PRODUCT = [...OFFER, 'productCard', 'productName', 'productImageUrl']
const ORDER = [...OFFER, 'itemsHtml', 'orderNumber']

const EMAIL: Record<string, string[]> = {
  abandoned_cart: CART, high_value_cart: CART, cart_price_drop: CART, wishlist_reminder: CART,
  abandoned_checkout: [...OFFER, 'itemsHtml', 'orderNumber', 'total'],
  post_purchase: ORDER, review_reminder: ORDER,
  restock: PRODUCT, back_in_stock_wishlist: PRODUCT, review_photo_followup: PRODUCT,
  price_drop: [...PRODUCT, 'oldPrice', 'newPrice'],
  viewed_product: [...OFFER, 'itemsHtml', 'cartItems', 'productName'],
  viewed_category: [...OFFER, 'itemsHtml', 'cartItems', 'categoryName'],
  replenishment: [...OFFER, 'itemsHtml', 'cartItems', 'productName'],
  subscription_renewal: [...OFFER, 'itemsHtml', 'cartItems', 'productName'],
  winback_90: [...OFFER, 'itemsHtml'], winback_180: [...OFFER, 'itemsHtml'], second_purchase_nudge: [...OFFER, 'itemsHtml'],
  first_purchase_nudge: OFFER, signup_anniversary: OFFER, birthday: OFFER,
  birthday_collect: ['firstName', 'ctaUrl'],
  loyalty_tier_upgrade: [...OFFER, 'points', 'tier'],
  loyalty_points_reminder: [...OFFER, 'points', 'pointsWorth', 'tier'],
  referral_invite: ['firstName', 'ctaUrl', 'referralCode', 'rewardPoints', 'shareUrl'],
}

// SMS / WhatsApp get the short-form set (no HTML blocks).
function shortForm(kind: string): string[] {
  const out = ['firstName', 'ctaUrl', 'couponCode', 'discountPercent', 'headline']
  if (MULTI_PRODUCT_KINDS.has(kind)) out.push('items')
  if (SINGLE_PRODUCT_KINDS.has(kind) || (EMAIL[kind] ?? []).includes('productName')) out.push('productName')
  if ((EMAIL[kind] ?? []).includes('orderNumber')) out.push('orderNumber')
  return out
}

function requiredFor(kind: string, channel: Channel): string[] {
  if (channel !== 'email') return []
  const req = ['ctaUrl']
  if (SINGLE_PRODUCT_KINDS.has(kind)) req.push('productCard')
  else if (MULTI_PRODUCT_KINDS.has(kind)) req.push('itemsHtml')
  if (kind === 'referral_invite') req.push('shareUrl')
  return req
}

export function isCampaignKind(kind: string | null | undefined): kind is string {
  return !!kind && kind in EMAIL
}

export function campaignVariables(kind: string, channel: Channel): KindVariable[] {
  const keys = channel === 'email' ? EMAIL[kind] ?? OFFER : shortForm(kind)
  const req = new Set(requiredFor(kind, channel))
  return keys.map(key => {
    const [label, description, sample] = DEFS[key] ?? [key, '', '']
    return { key, label, description, sample, required: req.has(key) }
  })
}

const usesVar = (text: string, key: string) => new RegExp(`\\{\\{?\\s*${key}\\s*\\}?\\}`).test(text)

/** Required variables the given template text doesn't use. */
export function missingRequired(kind: string | null | undefined, channel: Channel, text: string): string[] {
  if (!isCampaignKind(kind)) return []
  return requiredFor(kind, channel).filter(k => !usesVar(text, k))
}

export const variableUsed = usesVar
