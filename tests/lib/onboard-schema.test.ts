import { describe, it, expect } from 'vitest'
import { OnboardSchema } from '@/lib/onboard-schema'

/**
 * The pincode gate. A store that onboards without a usable 6-digit pincode reaches Razorpay as
 * postalCode "", which rejects the linked account — taking the stakeholder and settlement bank
 * with it, so the store goes live unable to be paid. That is what happened to aloys-store twice.
 */
const base = {
  planSlug: 'basic',
  ownerName: 'Asha Rao',
  displayName: 'Acme Tools',
  slug: 'acme-tools',
  businessName: 'Acme Pvt Ltd',
  businessType: 'pvt_ltd',
  pan: 'ABCDE1234F',
  gstNumber: '29ABCDE1234F1Z5',
  businessAddress: '42 Main Rd, Chennai, Tamil Nadu, 600001',
}

describe('OnboardSchema — pincode gate', () => {
  it('accepts an address containing a 6-digit pincode', () => {
    expect(OnboardSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a pincode supplied on the warehouse step', () => {
    const r = OnboardSchema.safeParse({
      ...base,
      businessAddress: 'Shop 4, Industrial Estate',
      warehouse: { originPincode: '560048' },
    })
    expect(r.success).toBe(true)
  })

  it('REJECTS an address with no pincode and no warehouse pincode', () => {
    // The exact shape that got through before: min(5) let "fgugcijhvb" pass.
    const r = OnboardSchema.safeParse({ ...base, businessAddress: 'fgugcijhvb' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].message).toMatch(/6-digit pincode is required/)
    expect(r.error!.issues[0].path).toEqual(['warehouse', 'originPincode'])
  })

  it('REJECTS a malformed warehouse pincode', () => {
    // Worse than absent: it reaches Razorpay and Delhivery as if it were real.
    const r = OnboardSchema.safeParse({
      ...base,
      businessAddress: 'Shop 4, Industrial Estate',
      warehouse: { originPincode: '5600' },
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error!.issues)).toMatch(/6 digits/)
  })

  it('does not mistake a longer number for a pincode', () => {
    const r = OnboardSchema.safeParse({ ...base, businessAddress: 'Plot 1234567890, Chennai' })
    expect(r.success).toBe(false)
  })
})
