import { inr } from './format'

// Mirror of controller-service components/visitor/coupons/terms.ts.

export interface CouponTermsInput {
  discountType: 'fixed' | 'percentage'
  value: number
  minPurchase: number
  maxDiscount: number | null
  validUntil?: string | null
}

export const rupees = (n: number) => `₹${inr(n).replace(/\.00$/, '')}`

export const formatExpiry = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "10% off (up to ₹150) on orders of ₹500 or more · valid till 12 Nov" */
export function couponTerms(c: CouponTermsInput, opts: { expiry?: boolean } = {}): string {
  const off =
    c.discountType === 'percentage'
      ? `${c.value}% off${c.maxDiscount ? ` (up to ${rupees(c.maxDiscount)})` : ''}`
      : `${rupees(c.value)} off`
  const min = c.minPurchase > 0 ? ` on orders of ${rupees(c.minPurchase)} or more` : ''
  const till =
    opts.expiry !== false && c.validUntil
      ? ` · valid till ${new Date(c.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : ''
  return `${off}${min}${till}`
}
