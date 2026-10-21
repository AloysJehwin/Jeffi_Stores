import { api } from './client'
import type { CardProduct } from '../types/home'

// Product page calls; same routes and payloads as the web PDP and its client components.

export interface PdpImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
  display_order?: number
  blurhash?: string | null
}

export interface PdpSubVariant {
  id: string
  sub_variant_name: string
  sku?: string | null
  price: number | null
  mrp: number | null
  price_ex_gst: number | null
  stock_status: string
  is_active: boolean
}

export interface PdpVariant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  mrp: number | null
  mrp_ex_gst?: number | null
  price_ex_gst: number | null
  stock_status: string
  pricing_type?: string
  unit?: string
  numeric_value?: number | null
  variant_type?: string | null
  sub_variant_type?: string | null
  sell_unit_id?: string | null
  is_active?: boolean
  variant_images?: PdpImage[]
  sub_variants?: PdpSubVariant[]
}

export interface PdpUnit {
  id: string
  variant_id: string | null
  sub_variant_id: string | null
  unit: string
  factor: number
  is_base: boolean
  is_purchase_default: boolean
  display_label: string | null
  dimension: string
  min_qty?: number | null
  max_qty?: number | null
  qty_step?: number | null
}

interface PolicyRef {
  id: string
  name: string
  slug: string
  return_allowed?: boolean | null
  return_window_days?: number | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | null
}

/** The /api/products/slug/:slug row (p.* plus the joined arrays); numeric columns may arrive as strings. */
export interface PdpProduct {
  id: string
  name: string
  slug: string
  sku: string
  description?: string | null
  base_price: number | string
  mrp?: number | string | null
  price_ex_gst?: number | string | null
  gst_percentage?: number | string | null
  stock_status: string
  has_variants: boolean
  variant_type?: string | null
  sub_variant_type?: string | null
  discount_pct?: number | string | null
  extra_delivery_days?: number | string | null
  handling_days?: number | string | null
  category_id?: string | null
  sell_unit_id?: string | null
  variant_min_price?: number | string | null
  variant_min_mrp?: number | string | null
  variant_stock_total?: number | string | null
  is_cod_allowed?: boolean | null
  is_digital?: boolean | null
  launch_date?: string | null
  discontinue_date?: string | null
  brands?: PolicyRef | null
  categories?: PolicyRef | null
  product_images: PdpImage[]
  product_variants: PdpVariant[]
  product_units?: PdpUnit[]
  [key: string]: any
}

/** The cart-line fields the picker's max_qty cap reads. */
export interface CartLine {
  product_id: string
  variant_id: string | null
  sub_variant_id?: string | null
  buy_mode: string | null
  quantity: number | string
}

export interface PdpReview {
  id: string
  user_id: string
  rating: number
  title: string | null
  comment: string
  is_verified_purchase: boolean
  is_approved: boolean
  image_urls: string[] | null
  image_thumbnail_urls: string[] | null
  created_at: string
  users: { first_name: string | null; last_name: string | null }
}

export interface PublicOffer {
  id: string
  title: string
  methods: string[]
  issuers: string[]
  endsAt: string | null
  terms: string | null
}

export async function getPdpProduct(slug: string): Promise<PdpProduct> {
  const data = await api<{ product: PdpProduct }>(`/api/products/slug/${encodeURIComponent(slug)}`, { token: null })
  return data.product
}

/** Fire-and-forget product_views row, as the web logs on mount. */
export function recordProductView(productId: string) {
  api(`/api/products/${productId}/view`, { method: 'POST' }).catch(() => {})
}

/** The web CartContext.addToCart body, including the sub-variant. */
export async function addPdpToCart(p: {
  productId: string
  quantity: number
  variantId?: string | null
  subVariantId?: string | null
  buyMode?: string
  buyUnit?: string | null
}): Promise<void> {
  await api('/api/cart', {
    method: 'POST',
    body: JSON.stringify({
      productId: p.productId,
      quantity: p.quantity,
      variantId: p.variantId || null,
      buyMode: p.buyMode ?? 'unit',
      buyUnit: p.buyUnit || null,
      subVariantId: p.subVariantId || null,
    }),
  })
}

export type BuyNowResult = { ok: true; intent: string } | { ok: false; error: string }

/** The web's startBuyNow: a single-item checkout intent that never touches the cart. */
export async function startBuyNow(input: {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  qty: number
  buyMode?: string
  buyUnit?: string | null
}): Promise<BuyNowResult> {
  try {
    const data = await api<{ intent?: string; error?: string }>('/api/checkout/intents', {
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
    if (!data.intent) return { ok: false, error: data.error || 'Failed to start checkout' }
    return { ok: true, intent: data.intent }
  } catch (e) {
    if (e instanceof TypeError) return { ok: false, error: 'Could not reach the server. Please try again.' }
    const msg = e instanceof Error ? e.message : ''
    return { ok: false, error: msg && !/^HTTP \d+$/.test(msg) ? msg : 'Failed to start checkout' }
  }
}

export async function checkDelivery(pincode: string): Promise<{ serviceable: boolean; message: string }> {
  return api(`/api/delivery-check?pincode=${pincode}`, { token: null })
}

export async function notifyBackInStock(productId: string, email: string): Promise<void> {
  await api('/api/notify-back-in-stock', { method: 'POST', body: JSON.stringify({ productId, email }) })
}

export async function getEddForPin(pin: string, handlingDays: number, extraDays: number): Promise<string | null> {
  const extra = extraDays > 0 ? `&extraDays=${extraDays}` : ''
  const d = await api<{ edd?: string }>(`/api/products/edd?pin=${pin}&handlingDays=${handlingDays}${extra}`).catch(() => null)
  return d?.edd ?? null
}

/** "Frequently bought together" (bought) / "Customers also viewed" (viewed), as card props. */
export async function getAffinity(kind: 'bought' | 'viewed', productId: string, limit: number): Promise<CardProduct[]> {
  const d = await api<{ products?: CardProduct[] }>(
    `/api/products/affinity?kind=${kind}&ids=${encodeURIComponent(productId)}&limit=${limit}`,
    { token: null }
  )
  return Array.isArray(d?.products) ? d.products : []
}

/** Same-category listing rows the related products / compare section are drawn from. */
export async function getCategoryRows(categorySlug: string, limit = 20): Promise<PdpProduct[]> {
  const d = await api<{ products?: PdpProduct[] }>(
    `/api/products?category=${encodeURIComponent(categorySlug)}&limit=${limit}`,
    { token: null }
  )
  return Array.isArray(d?.products) ? d.products : []
}

export async function getRazorpayOffers(): Promise<PublicOffer[]> {
  const d = await api<{ offers?: PublicOffer[] }>('/api/razorpay/offers', { token: null })
  return Array.isArray(d?.offers) ? d.offers : []
}

export async function getProductReviews(productId: string): Promise<PdpReview[]> {
  const d = await api<{ reviews?: PdpReview[] }>(`/api/reviews?productId=${productId}`)
  return d.reviews || []
}

export async function getVaultOwned(productId: string): Promise<{ owned: boolean; url: string | null }> {
  const d = await api<{ owned?: boolean; url?: string | null }>(`/api/vault/owned?productId=${encodeURIComponent(productId)}`)
  return { owned: !!d?.owned, url: d?.url ?? null }
}

/** The delivery_free_threshold checkout applies; 0 when none is set or delivery charges are off. */
export async function getFreeDeliveryThreshold(): Promise<number> {
  const d = await api<{ freeThreshold?: number }>('/api/cart/free-delivery', { token: null })
  return Number(d?.freeThreshold ?? 0)
}
