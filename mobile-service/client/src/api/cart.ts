import { api } from './client'

// The rows GET /api/cart returns (same shape the web's CartContext reads). Numeric columns can arrive as strings.
export interface CartItemUnit {
  unit: string
  display_label: string | null
  factor: number
  is_base: boolean
  dimension: string | null
  min_qty?: number | null
  max_qty?: number | null
  qty_step?: number | null
}

export interface CartLineImage {
  thumbnail_url: string
  image_url: string
  is_primary: boolean
  blurhash?: string | null
}

export interface CartLine {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  quantity: number
  price_at_addition: number
  buy_mode: string
  buy_unit: string | null
  is_digital?: boolean | null
  cart_item_unit?: CartItemUnit | null
  products: {
    id: string
    name: string
    slug: string
    sku: string | null
    base_price: number
    price_ex_gst: number | null
    mrp: number | null
    gst_percentage: number | null
    stock_status: string
    brand_name: string | null
    category_id: string | null
    is_active?: boolean | null
    is_cod_allowed?: boolean | null
    is_digital?: boolean | null
    fragile?: boolean | null
    hazardous?: boolean | null
    flammable?: boolean | null
    handling_days?: number | null
    extra_delivery_days?: number | null
    product_images: CartLineImage[]
  }
  variant: {
    id: string
    variant_name: string
    sku: string | null
    price: number | null
    mrp: number | null
    price_ex_gst: number | null
    stock_status: string
  } | null
  sub_variant: {
    id: string
    sub_variant_name: string
    sku: string | null
    price: number | null
    mrp: number | null
    price_ex_gst: number | null
    stock_status: string
  } | null
}

export interface CartResponse {
  items: CartLine[]
}

export interface CouponResult {
  couponId: string
  code: string
  description: string | null
  discountType?: string
  discountValue?: number
  discountAmount: number
}

export interface CouponNudge {
  code: string
  saving: number
  shortfall: number
}

export interface BuyNowIntent {
  mode: 'buyNow'
  productId: string
  variantId: string | null
  subVariantId: string | null
  qty: number
  buyMode: string
  buyUnit: string | null
  price: number
  productName: string
  variantName: string | null
  subVariantName: string | null
  sku: string | null
  mrp: number | null
  gstPercentage: number | null
  brandName: string | null
  extraDeliveryDays: number
  handlingDays: number | null
  isDigital: boolean
  businessDiscount: number
}

export type CheckoutIntent = { mode: 'cart'; itemCount: number; subtotal: number; addressId: string | null } | BuyNowIntent

export async function getCart(): Promise<CartResponse> {
  return api('/api/cart')
}

/** Lines the shopper moved to "Saved for later". */
export async function getSavedCart(): Promise<CartResponse> {
  return api('/api/cart?saved=1')
}

export async function addToCart(payload: {
  product_id: string
  variant_id?: string | null
  sub_variant_id?: string | null
  quantity: number
  buy_mode?: string
  buy_unit?: string | null
}): Promise<void> {
  await api<unknown>('/api/cart', {
    method: 'POST',
    body: JSON.stringify({
      productId: payload.product_id,
      variantId: payload.variant_id ?? null,
      subVariantId: payload.sub_variant_id ?? null,
      quantity: payload.quantity,
      buyMode: payload.buy_mode ?? 'unit',
      buyUnit: payload.buy_unit ?? null,
    }),
  })
}

export async function updateCartItem(itemId: string, quantity: number): Promise<void> {
  await api<unknown>('/api/cart', {
    method: 'PATCH',
    body: JSON.stringify({ cartItemId: itemId, quantity }),
  })
}

export async function removeCartItem(itemId: string): Promise<void> {
  await api<unknown>(`/api/cart?id=${itemId}`, { method: 'DELETE' })
}

export async function saveForLater(itemId: string): Promise<void> {
  await api<unknown>('/api/cart', { method: 'PATCH', body: JSON.stringify({ cartItemId: itemId, savedForLater: true }) })
}

export async function moveToCart(itemId: string): Promise<void> {
  await api<unknown>('/api/cart', { method: 'PATCH', body: JSON.stringify({ cartItemId: itemId, savedForLater: false }) })
}

export async function getFreeDeliveryRule(): Promise<{ freeThreshold: number; weightLimitKg: number } | null> {
  return api('/api/cart/free-delivery')
}

export async function getCouponNudge(subtotal: number): Promise<CouponNudge | null> {
  const data = await api<{ nudge?: CouponNudge | null }>(`/api/coupons/nudge?subtotal=${subtotal}`)
  return data?.nudge ?? null
}

/** POST /api/coupons/apply by code or by couponId. */
export async function applyCoupon(payload: { code?: string; couponId?: string; subtotal: number }): Promise<CouponResult> {
  return api('/api/coupons/apply', { method: 'POST', body: JSON.stringify(payload) })
}

/** The coupon earned by leaving a review, if any (CouponHintBanner). */
export async function getReviewCoupon(): Promise<{ id: string; code: string; discount_type: string; discount_value: number } | null> {
  const data = await api<{ coupon?: any }>('/api/user/review-coupons')
  return data?.coupon ?? null
}

/** Signed checkout intent for the whole cart (the web's "Proceed to Checkout"). */
export async function createCartIntent(): Promise<string> {
  const data = await api<{ intent?: string }>('/api/checkout/intents', { method: 'POST', body: JSON.stringify({ mode: 'cart' }) })
  if (!data?.intent) throw new Error('Failed to start checkout')
  return data.intent
}

/** Single-item Buy Now intent; never touches the cart. */
export async function createBuyNowIntent(input: {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  qty: number
  buyMode?: string
  buyUnit?: string | null
}): Promise<string> {
  const data = await api<{ intent?: string }>('/api/checkout/intents', {
    method: 'POST',
    body: JSON.stringify({
      productId: input.productId,
      variantId: input.variantId || null,
      subVariantId: input.subVariantId || null,
      qty: input.qty,
      buyMode: input.buyMode ?? 'unit',
      buyUnit: input.buyUnit ?? null,
    }),
  })
  if (!data?.intent) throw new Error('Failed to start checkout')
  return data.intent
}

export async function getCheckoutIntent(token: string): Promise<CheckoutIntent> {
  return api(`/api/checkout/intents/${encodeURIComponent(token)}`)
}

export async function getPrimaryImage(productId: string, variantId?: string | null): Promise<string | null> {
  const data = await api<{ imageUrl?: string | null }>(
    `/api/products/${productId}/primary-image${variantId ? `?variantId=${variantId}` : ''}`
  )
  return data?.imageUrl ?? null
}

export async function getStoreSettings(): Promise<{ minOrderAmount?: number }> {
  return api('/api/store-settings')
}
