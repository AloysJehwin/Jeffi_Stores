import { describe, it, expect } from 'vitest'
import { OnboardSchema } from '@controller/lib/catalog/onboard-schema'

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
  businessName: 'Acme Traders',
  businessType: 'partnership',
  // KYB (lib/kyb): a firm's PAN (4th letter F) and a GSTIN carrying it, registered in the address's state.
  entityType: 'partnership',
  pan: 'AAPFU0939F',
  gstRegistered: true,
  gstNumber: '27AAPFU0939F1ZV',
  businessAddress: '42 Main Rd, Mumbai, Maharashtra 400001',
  addressLine: '42 Main Rd',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  authorizedName: 'Asha Rao',
  authorizedDesignation: 'Partner',
  kybDocs: { pan_card: { s3Key: 'kyc/o-1/pan_card/p.pdf' }, gst_cert: { s3Key: 'kyc/o-1/gst_cert/g.pdf' } },
  // The licence questions every store answers (lib/catalog/compliance.ts).
  compliance: { answers: { restricted: false, import: false } },
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

describe('OnboardSchema — PAN', () => {
  it('REJECTS a 10-character PAN in the wrong shape', () => {
    // The dummy a live onboarding got through with when only the length was checked.
    const r = OnboardSchema.safeParse({ ...base, pan: 'F6TRYCYT56' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].path).toEqual(['pan'])
    expect(OnboardSchema.safeParse({ ...base, pan: 'ABCDE12345' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, pan: 'ABCD01234F' }).success).toBe(false)
    // A firm's PAN for a sole proprietorship, which uses the proprietor's own (4th letter P).
    const p = OnboardSchema.safeParse({ ...base, entityType: 'proprietor', businessType: 'proprietor' })
    expect(p.success).toBe(false)
    expect(p.error!.issues[0].path).toEqual(['pan'])
  })

  it('accepts a PAN typed in lower case or with spaces round it, stored in capitals', () => {
    const r = OnboardSchema.safeParse({ ...base, pan: ' aapfu0939f ' })
    expect(r.success).toBe(true)
    expect(r.data!.pan).toBe('AAPFU0939F')
  })
})

describe('OnboardSchema — GSTIN and licences', () => {
  it('takes no GSTIN without GST, but a reason and a registration proof; a registered business needs its GSTIN', () => {
    const udyam = { s3Key: 'kyc/o-1/udyam/u.pdf', number: 'UDYAM-MH-19-0012345' }
    const unregistered = { ...base, gstRegistered: false, gstNumber: '', gstExemptReason: 'below_threshold', kybDocs: { pan_card: base.kybDocs.pan_card, udyam } }
    expect(OnboardSchema.safeParse(unregistered).success).toBe(true)
    expect(OnboardSchema.safeParse({ ...unregistered, gstExemptReason: undefined }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...unregistered, kybDocs: { pan_card: base.kybDocs.pan_card } }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...unregistered, kybDocs: { ...unregistered.kybDocs, udyam: { ...udyam, number: 'UDYAM-12' } } }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, gstNumber: '' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, gstNumber: '27AAPFU' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, kybDocs: { pan_card: base.kybDocs.pan_card } }).success).toBe(false)
  })

  it('REJECTS a 15-character GSTIN in the wrong shape, or one that fails its check character', () => {
    expect(OnboardSchema.safeParse({ ...base, gstNumber: '99ABCDE1234F1Z5' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, gstNumber: 'ABCDEFGHIJKLMNO' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, gstNumber: '27AAPFU0939F1ZW' }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, gstNumber: '27aapfu0939f1zv' }).data?.gstNumber).toBe('27AAPFU0939F1ZV')
  })

  it('requires the licences a category needs, complete and in date', () => {
    const food = { ...base, productCategories: 'Food & Groceries', compliance: { answers: { restricted: false, import: false, 'do-you-pack-or-import-packaged-food': false, 'do-you-label-products-as-organic': false } } }
    const r = OnboardSchema.safeParse(food)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error!.issues)).toMatch(/FSSAI/)
    const fssai = { s3Key: 'kyc/o-1/fssai/x.pdf', number: '12345678901234', expiresOn: '2099-01-01' }
    expect(OnboardSchema.safeParse({ ...food, compliance: { ...food.compliance, docs: { fssai } } }).success).toBe(true)
    expect(OnboardSchema.safeParse({ ...food, compliance: { ...food.compliance, docs: { fssai: { ...fssai, number: '123' } } } }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...food, compliance: { ...food.compliance, docs: { fssai: { ...fssai, expiresOn: '2020-01-01' } } } }).success).toBe(false)
  })

  it('refuses restricted goods and unanswered questions', () => {
    expect(OnboardSchema.safeParse({ ...base, compliance: { answers: { restricted: true, import: false } } }).success).toBe(false)
    expect(OnboardSchema.safeParse({ ...base, compliance: { answers: { import: false } } }).success).toBe(false)
  })
})
