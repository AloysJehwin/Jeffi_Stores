import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn()
const resolveRequestTenant = vi.fn()
const getRazorpayInstanceFor = vi.fn()
const orderUrlById = vi.fn(async (..._a: any[]) => 'https://store/orders/o1')

vi.mock('@/lib/shared/db', () => ({
  queryOne: (...a: any[]) => queryOne(...a),
  resolveRequestTenant: (...a: any[]) => resolveRequestTenant(...a),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: (...a: any[]) => getRazorpayInstanceFor(...a) }))
vi.mock('@/lib/shared/customer-links', () => ({ orderUrlById: (...a: any[]) => orderUrlById(...a) }))

import { createOrderPaymentLink, PaymentLinkError } from '@/lib/payments/payment-link'

const paymentLink = { create: vi.fn(), fetch: vi.fn() }
beforeEach(() => {
  queryOne.mockReset()
  resolveRequestTenant.mockReset()
  getRazorpayInstanceFor.mockReset().mockResolvedValue({ instance: { paymentLink } })
  paymentLink.create.mockReset()
  paymentLink.fetch.mockReset()
})

function order(over: Record<string, unknown> = {}) {
  return { id: 'o1', order_number: 'ORD-1', total_amount: '100.00', customer_name: 'N', customer_email: 'e@x.com', customer_phone: '9876543210', payment_status: 'pending', payment_link_id: null, payment_link_status: null, payment_link_url: null, ...over }
}

describe('createOrderPaymentLink', () => {
  it('throws 404 when the order is missing', async () => {
    queryOne.mockResolvedValueOnce(null)
    await expect(createOrderPaymentLink('o1')).rejects.toMatchObject({ status: 404 })
  })
  it('throws 409 when already paid', async () => {
    queryOne.mockResolvedValueOnce(order({ payment_status: 'paid' }))
    await expect(createOrderPaymentLink('o1')).rejects.toBeInstanceOf(PaymentLinkError)
  })
  it('reuses a still-created existing link', async () => {
    queryOne.mockResolvedValueOnce(order({ payment_link_id: 'plink_1', payment_link_status: 'created', payment_link_url: 'https://rzp/l/1' }))
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    paymentLink.fetch.mockResolvedValue({ status: 'created', short_url: 'https://rzp/l/fetched' })
    const r = await createOrderPaymentLink('o1')
    expect(r).toEqual({ paymentLinkId: 'plink_1', paymentLinkUrl: 'https://rzp/l/1', alreadyExists: true })
    expect(paymentLink.create).not.toHaveBeenCalled()
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
  })
  it('creates a new link (amount in paise, notes carry tenant) and persists it', async () => {
    queryOne.mockResolvedValueOnce(order({ total_amount: '100.50' }))
    queryOne.mockResolvedValueOnce({}) // the UPDATE
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    paymentLink.create.mockResolvedValue({ id: 'plink_new', short_url: 'https://rzp/l/new' })
    const r = await createOrderPaymentLink('o1', 24, true)
    expect(r.paymentLinkId).toBe('plink_new')
    expect(r.paymentLinkUrl).toBe('https://rzp/l/new')
    expect(r.expiresAt).toBeDefined()
    const body = paymentLink.create.mock.calls[0][0]
    expect(body.amount).toBe(10050)
    expect(body.notify).toEqual({ sms: true, email: true })
    expect(body.notes).toMatchObject({ order_id: 'o1', order_number: 'ORD-1', tenant_id: 't1', tenant_slug: 's1' })
    expect(body.callback_url).toBe('https://store/orders/o1')
    // UPDATE persisted
    const updateCall = queryOne.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE orders SET payment_link_id')
    expect(updateCall[1][0]).toBe('plink_new')
  })
  it('notify false and no tenant: suppress sms/email, omit tenant notes', async () => {
    queryOne.mockResolvedValueOnce(order())
    queryOne.mockResolvedValueOnce({})
    resolveRequestTenant.mockResolvedValue(null)
    paymentLink.create.mockResolvedValue({ id: 'plink_2', short_url: 'u' })
    await createOrderPaymentLink('o1', 48, false)
    const body = paymentLink.create.mock.calls[0][0]
    expect(body.notify).toEqual({ sms: false, email: false })
    expect(body.notes.tenant_id).toBeUndefined()
    expect(body.notes.tenant_slug).toBeUndefined()
  })
  it('creates fresh when an existing link is no longer created', async () => {
    queryOne.mockResolvedValueOnce(order({ payment_link_id: 'plink_old', payment_link_status: 'created' }))
    queryOne.mockResolvedValueOnce({})
    resolveRequestTenant.mockResolvedValue(null)
    paymentLink.fetch.mockResolvedValue({ status: 'expired' })
    paymentLink.create.mockResolvedValue({ id: 'plink_fresh', short_url: 'u2' })
    const r = await createOrderPaymentLink('o1')
    expect(r.paymentLinkId).toBe('plink_fresh')
  })
})
