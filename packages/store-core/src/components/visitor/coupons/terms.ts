export interface CouponTermsInput {
  discountType: 'fixed' | 'percentage'
  value: number
  minPurchase: number
  maxDiscount: number | null
  validUntil?: string | null
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export function couponOff(c: CouponTermsInput): string {
  return c.discountType === 'percentage'
    ? `${c.value}% off${c.maxDiscount ? ` (up to ${formatMoney(c.maxDiscount)})` : ''}`
    : `${formatMoney(c.value)} off`
}

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "10% off (up to ₹150) on orders of ₹500 or more · valid till 12 Nov". */
export function couponTerms(c: CouponTermsInput, opts: { expiry?: boolean } = {}): string {
  const min = c.minPurchase > 0 ? ` on orders of ${formatMoney(c.minPurchase)} or more` : ''
  const until =
    opts.expiry !== false && c.validUntil
      ? ` · valid till ${new Date(c.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : ''
  return `${couponOff(c)}${min}${until}`
}

/** `/cart?coupon=CODE`: the cart applies it once there are items. */
export function cartCouponHref(code: string): string {
  return `/cart?coupon=${encodeURIComponent(code)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type UrlCoupon = { code: string } | { id: string }

/** The coupon a cart/checkout URL carries: `coupon` / `couponCode` (a code) or `couponId`. */
export function urlCoupon(params: { get(name: string): string | null }): UrlCoupon | null {
  const code = (params.get('coupon') ?? params.get('couponCode'))?.trim().toUpperCase()
  if (code) return { code }
  const id = params.get('couponId')?.trim()
  return id && UUID.test(id) ? { id } : null
}

export function urlCouponCode(c: UrlCoupon | null): string | null {
  return c && 'code' in c ? c.code : null
}

/** The /api/coupons/apply lookup for it. */
export function couponLookup(c: UrlCoupon): { code: string } | { couponId: string } {
  return 'code' in c ? { code: c.code } : { couponId: c.id }
}

/** Query params that hand the coupon on: the cart reads `coupon`, the review page `couponCode`. */
export function couponQuery(c: UrlCoupon | null, target: 'cart' | 'review'): Record<string, string> {
  if (!c) return {}
  if (!('code' in c)) return { couponId: c.id }
  return target === 'cart' ? { coupon: c.code } : { couponCode: c.code }
}

/** `path` with the coupon's query params appended. */
export function withCoupon(path: string, c: UrlCoupon | null, target: 'cart' | 'review'): string {
  const qs = new URLSearchParams(couponQuery(c, target)).toString()
  if (!qs) return path
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`
}
