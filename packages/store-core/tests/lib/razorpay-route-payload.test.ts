import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create, edit } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 'acc_TEST' }),
  edit: vi.fn().mockResolvedValue({ id: 'acc_TEST' }),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => ({ accounts: { create, edit } }) }))

import { createLinkedAccount, mapBusinessType } from '@/lib/payments/razorpay-route'

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

describe('createLinkedAccount recovers an account Razorpay says already exists', () => {
  beforeEach(() => {
    create.mockClear()
    edit.mockClear()
  })

  it('parses the acc_xxx out of the "already exists" rejection and returns it', async () => {
    create.mockRejectedValueOnce({
      error: { description: 'Merchant email already exists for account - SaHo7ZCJdfqIp0' },
    })
    const id = await createLinkedAccount(BASE)
    expect(id).toBe('acc_SaHo7ZCJdfqIp0')
  })

  it('handles an already-prefixed acc_ id in the rejection', async () => {
    create.mockRejectedValueOnce({
      error: { description: 'Merchant email already exists for account - acc_SaHo7ZCJdfqIp0' },
    })
    expect(await createLinkedAccount(BASE)).toBe('acc_SaHo7ZCJdfqIp0')
  })

  it('PATCHes the recovered account with the current KYC (never business_type or email)', async () => {
    create.mockRejectedValueOnce({
      error: { description: 'Merchant email already exists for account - SaHo7ZCJdfqIp0' },
    })
    await createLinkedAccount(BASE)
    expect(edit).toHaveBeenCalledTimes(1)
    const [id, body] = edit.mock.calls[0]
    expect(id).toBe('acc_SaHo7ZCJdfqIp0')
    expect(body.legal_business_name).toBe(BASE.legalBusinessName)
    expect(body.business_type).toBeUndefined()
    expect(body.email).toBeUndefined()
  })

  it('still returns the recovered id when the PATCH itself fails (best-effort)', async () => {
    create.mockRejectedValueOnce({
      error: { description: 'Merchant email already exists for account - SaHo7ZCJdfqIp0' },
    })
    edit.mockRejectedValueOnce(new Error('activation form locked'))
    expect(await createLinkedAccount(BASE)).toBe('acc_SaHo7ZCJdfqIp0')
  })

  it('rethrows a rejection that is not the already-exists case', async () => {
    create.mockRejectedValueOnce({ error: { description: 'The postal code must be an integer' } })
    await expect(createLinkedAccount(BASE)).rejects.toBeTruthy()
    expect(edit).not.toHaveBeenCalled()
  })
})
