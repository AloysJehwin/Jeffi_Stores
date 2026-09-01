import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'acc_TEST' }) }))
vi.mock('@/lib/razorpay', () => ({ getRazorpayInstance: () => ({ accounts: { create } }) }))

import { createLinkedAccount, mapBusinessType } from '@/lib/razorpay-route'

const BASE = {
  businessName: 'Aloys Jehwin',
  businessType: 'proprietorship' as const,
  legalBusinessName: 'Aloys Jehwin',
  profileCategory: 'ecommerce',
  profileSubcategory: 'electronics',
  ownerEmail: 'owner@acme.test',
  ownerPhone: '9489254099',
  ownerName: 'Aloys Jehwin',
  pan: 'CJTPJ2814F',
  streetAddress: 'XPP8+PVR',
  city: 'Mahadevapura',
  state: 'Karnataka',
  postalCode: '560048',
}

// Razorpay's own field, documented at POST /v2/accounts.
describe('the create request matches what Razorpay documents', () => {
  beforeEach(() => create.mockClear())

  it('sends business_type without the route_ prefix', async () => {
    await createLinkedAccount(BASE)
    // `route` belongs in `type`; a prefixed business_type is rejected as "Invalid business type".
    expect(create.mock.calls[0][0].business_type).toBe('proprietorship')
    expect(create.mock.calls[0][0].type).toBe('route')
  })

  it('maps every KYC business type to an unprefixed value', () => {
    for (const kyc of ['proprietor', 'partnership', 'pvt_ltd', 'llp', 'other', 'unknown']) {
      expect(mapBusinessType(kyc), kyc).not.toMatch(/^route_/)
    }
  })

  it('upper-cases the state, which Razorpay supplies as a fixed upper-case list', async () => {
    await createLinkedAccount(BASE)
    expect(create.mock.calls[0][0].profile.addresses.registered.state).toBe('KARNATAKA')
  })

  it('omits legal_info entirely for a proprietor with an individual PAN', async () => {
    // Razorpay allows only C,H,F,A,T,B,J,G,L at position 4 — never P.
    await createLinkedAccount(BASE)
    expect(create.mock.calls[0][0].legal_info).toBeUndefined()
  })

  it('sends a valid GSTIN, which used to be accepted and silently dropped', async () => {
    await createLinkedAccount({ ...BASE, gstNumber: '29AQFPJ2897M1ZG' })
    expect(create.mock.calls[0][0].legal_info).toEqual({ gst: '29AQFPJ2897M1ZG' })
  })

  it('omits a malformed GSTIN rather than letting it reject the create', async () => {
    await createLinkedAccount({ ...BASE, gstNumber: 'not-a-gstin' })
    expect(create.mock.calls[0][0].legal_info).toBeUndefined()
  })

  it('sends a company PAN when it matches the business type', async () => {
    await createLinkedAccount({ ...BASE, businessType: 'partnership', pan: 'AAAFL1234C' })
    expect(create.mock.calls[0][0].legal_info).toEqual({ pan: 'AAAFL1234C' })
  })
})
