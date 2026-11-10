import type { ComposerVariable } from './variables'

// Per-recipient tokens the campaign runner fills (in addition to the shared Site Controls variables).
const v = (key: string, label: string, description: string, sample: string): ComposerVariable => ({
  key,
  label,
  description,
  sample,
  group: 'order',
  builtIn: true,
  section: 'Campaign',
})

export const CAMPAIGN_VARIABLES: ComposerVariable[] = [
  v('firstName', 'First name', "Recipient's first name", 'Sample'),
  v('itemsHtml', 'Product gallery', 'Block: product rows with thumbnails (multi-product scenarios)', 'table'),
  v('productCard', 'Product card', 'Block: single product image + name + price card', 'card'),
  v('itemCount', 'Item count', 'Number of items in the cart/order', '2'),
  v('orderNumber', 'Order number', 'Order reference', 'TEST-12345'),
  v('total', 'Total', 'Order/cart total', '2200.00'),
  v('couponCode', 'Coupon code', 'Attached coupon code', 'BACK-AB12CD'),
  v('discountPercent', 'Discount %', 'Coupon discount percentage', '10'),
  v('productName', 'Product name', 'Featured product name', 'Sample Product'),
  v('productImageUrl', 'Product image URL', 'Use inside an image src', 'https://…'),
  v('oldPrice', 'Old price', 'Price before the drop', '999'),
  v('newPrice', 'New price', 'Current price', '799'),
  v('ctaUrl', 'CTA URL', 'Link target for the call-to-action', 'https://…'),
]

const m = (key: string, label: string, description: string, sample: string): ComposerVariable => ({
  key,
  label,
  description,
  sample,
  group: 'order',
  builtIn: true,
  section: 'Message',
})

// What a Messaging broadcast fills per recipient (the coupon ones only when a coupon is picked).
export const MESSAGING_VARIABLES: ComposerVariable[] = [
  m('firstName', 'First name', "Recipient's first name", 'Priya'),
  m('couponCode', 'Coupon code', "The message's coupon code", 'DIWALI20'),
  m('discountLabel', 'Discount', 'The coupon discount, e.g. 20% off', '20% off'),
  m('discountPercent', 'Discount %', 'Percentage coupons only', '20'),
]
