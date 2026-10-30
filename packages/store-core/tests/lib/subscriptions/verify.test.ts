import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => ({ tenantId: 't1', slug: 'acme' })) }))
vi.mock('@/lib/subscriptions/cycle', () => ({
  commitCycle: vi.fn(async () => ({ created: true, orderId: 'o1', orderNumber: 'ORD-1', cycle: 1 })),
  applySubscriptionState: vi.fn(async () => ({ row: { status: 'active' }, prevStatus: 'created', changed: true })),
  unixToDate: (v: number) => (v ? new Date(v * 1000) : null),
}))
const rz = { subscriptions: { fetch: vi.fn() }, payments: { fetch: vi.fn() } }
vi.mock('@/lib/subscriptions/service', () => ({
  razorpayForSubscription: vi.fn(async () => ({ instance: rz, keySecret: 'secret' })),
}))

import { queryOne } from '@/lib/shared/db'
import { commitCycle, applySubscriptionState } from '@/lib/subscriptions/cycle'
import { verifySubscriptionPayment } from '@/lib/subscriptions/verify'

const sign = (p: string, s: string) => crypto.createHmac('sha256', 'secret').update(`${p}|${s}`).digest('hex')

describe('verifySubscriptionPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockResolvedValue({ id: 'L1', collecting_account: 'platform', user_id: 'u1' })
    rz.subscriptions.fetch.mockResolvedValue({ id: 'sub_1', status: 'active', paid_count: 1, current_end: 1800000000 })
    rz.payments.fetch.mockResolvedValue({ id: 'pay_1', status: 'captured', amount: 45000, invoice_id: 'inv_1' })
  })

  it('rejects a bad signature without touching Razorpay or the DB', async () => {
    await expect(
      verifySubscriptionPayment({ userId: 'u1', razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_1', razorpay_signature: 'nope' })
    ).rejects.toThrow('Invalid payment signature')
    expect(rz.subscriptions.fetch).not.toHaveBeenCalled()
    expect(commitCycle).not.toHaveBeenCalled()
  })

  it('verifies HMAC(payment_id|subscription_id) and commits cycle paid_count', async () => {
    const r = await verifySubscriptionPayment({
      userId: 'u1',
      razorpay_payment_id: 'pay_1',
      razorpay_subscription_id: 'sub_1',
      razorpay_signature: sign('pay_1', 'sub_1'),
    })
    expect(r).toEqual({ localId: 'L1', status: 'active', orderId: 'o1', orderNumber: 'ORD-1' })
    expect(commitCycle).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'L1', paymentId: 'pay_1', paidCount: 1, amountPaise: 45000, invoiceId: 'inv_1' })
    )
    expect(applySubscriptionState).toHaveBeenCalledWith('L1', 'active', expect.anything())
  })

  it('does not commit an order for an uncaptured payment', async () => {
    rz.payments.fetch.mockResolvedValue({ id: 'pay_1', status: 'authorized', amount: 45000 })
    const r = await verifySubscriptionPayment({
      userId: 'u1',
      razorpay_payment_id: 'pay_1',
      razorpay_subscription_id: 'sub_1',
      razorpay_signature: sign('pay_1', 'sub_1'),
    })
    expect(commitCycle).not.toHaveBeenCalled()
    expect(r.orderId).toBeNull()
  })

  it('404s a subscription that is not the caller’s', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    await expect(
      verifySubscriptionPayment({ userId: 'u2', razorpay_payment_id: 'p', razorpay_subscription_id: 's', razorpay_signature: 'x' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
