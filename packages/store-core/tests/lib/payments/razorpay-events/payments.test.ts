import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/capture', () => ({
  applyCapturedPayment: vi.fn(),
  applyLinkPayment: vi.fn(),
  applyQrPayment: vi.fn(),
  recordPaymentDetails: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/payments/webhook-tenant', () => ({ runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()) }))
vi.mock('@/lib/payments/razorpay-events/context', () => ({
  inPaymentStore: vi.fn(),
  storeFor: vi.fn(),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: vi.fn(), getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/qr-intents', () => ({ applyQrIntentPayment: vi.fn(async () => 'unmatched') }))
vi.mock('@/lib/billing/topup', () => ({ creditTopup: vi.fn(() => Promise.resolve()) }))

import {
  onPaymentCaptured,
  onPaymentFailed,
  onPaymentLinkPaid,
  onPaymentLinkExpired,
  onQrCodeCredited,
} from '@/lib/payments/razorpay-events/payments'
import { queryOne } from '@/lib/shared/db'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { applyCapturedPayment, applyLinkPayment, applyQrPayment, recordPaymentDetails } from '@/lib/payments/capture'
import { inPaymentStore, storeFor } from '@/lib/payments/razorpay-events/context'
import { getRazorpayInstance, getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { applyQrIntentPayment } from '@/lib/payments/qr-intents'
import { creditTopup } from '@/lib/billing/topup'

const store = { tenantId: 't1', slug: 'acme', ctx: null }
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(inPaymentStore).mockImplementation(async (_c: any, _p: any, fn: any) => fn(store))
  vi.mocked(storeFor).mockResolvedValue(store as any)
  vi.mocked(applyQrIntentPayment).mockResolvedValue('unmatched')
})

describe('onPaymentCaptured', () => {
  it('returns unmatched for a payment with no id', async () => {
    expect(await onPaymentCaptured({}, ctx())).toBe('unmatched')
    expect(inPaymentStore).not.toHaveBeenCalled()
  })

  it('credits a wallet top-up on the platform account', async () => {
    const rzp = { orders: { fetch: vi.fn(async () => ({ notes: { credit_inr: 50 } })) } }
    vi.mocked(getRazorpayInstance).mockReturnValue(rzp as any)
    const r = await onPaymentCaptured({ id: 'p', notes: { purpose: 'wallet_topup', tenant_id: 't1' }, amount: 5000, order_id: 'o1' }, ctx({ source: 'platform' }))
    expect(r).toBe('wallet')
    expect(creditTopup).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', paymentId: 'p', paidPaise: 5000 }))
  })

  it('does not credit a top-up on own account but still returns wallet', async () => {
    const r = await onPaymentCaptured({ id: 'p', notes: { purpose: 'wallet_topup' }, amount: 5000 }, ctx({ source: 'own', store }))
    expect(r).toBe('wallet')
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('skips the top-up credit when tenant or amount is missing', async () => {
    await onPaymentCaptured({ id: 'p', notes: { purpose: 'wallet_topup', tenant_id: '' }, amount: 5000 }, ctx())
    expect(creditTopup).not.toHaveBeenCalled()
    await onPaymentCaptured({ id: 'p', notes: { purpose: 'wallet_topup', tenant_id: 't1' }, amount: 0 }, ctx())
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('applies a captured order payment and records details when matched', async () => {
    vi.mocked(applyCapturedPayment).mockResolvedValue('captured' as any)
    const r = await onPaymentCaptured({ id: 'p', amount: 100, order_id: 'o1' }, ctx())
    expect(r).toBe('captured')
    expect(applyCapturedPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }), store)
    expect(recordPaymentDetails).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }), expect.objectContaining({ account: 'platform' }))
  })

  it('does not record details when the payment was unmatched', async () => {
    vi.mocked(applyCapturedPayment).mockResolvedValue('unmatched' as any)
    const r = await onPaymentCaptured({ id: 'p', amount: 100 }, ctx())
    expect(r).toBe('unmatched')
    expect(recordPaymentDetails).not.toHaveBeenCalled()
  })

  it('swallows a recordPaymentDetails rejection', async () => {
    vi.mocked(applyCapturedPayment).mockResolvedValue('captured' as any)
    vi.mocked(recordPaymentDetails).mockRejectedValue(new Error('details db'))
    await expect(onPaymentCaptured({ id: 'p', amount: 100 }, ctx())).resolves.toBe('captured')
  })

  it('swallows a failed orders.fetch and creditTopup during wallet top-up', async () => {
    vi.mocked(getRazorpayInstance).mockReturnValue({ orders: { fetch: vi.fn(async () => { throw new Error('rzp') }) } } as any)
    vi.mocked(creditTopup).mockRejectedValue(new Error('credit db'))
    const r = await onPaymentCaptured({ id: 'p', notes: { purpose: 'wallet_topup', tenant_id: 't1' }, amount: 5000, order_id: 'o1' }, ctx({ source: 'platform' }))
    expect(r).toBe('wallet')
    expect(creditTopup).toHaveBeenCalled()
  })
})

describe('onPaymentFailed', () => {
  it('returns early when there is no order_id', async () => {
    await onPaymentFailed({ id: 'p' }, ctx())
    expect(inPaymentStore).not.toHaveBeenCalled()
  })

  it('marks the payment failed and opens an auto-task for the owner', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord_1' } as any) // find payment by rzp order
      .mockResolvedValueOnce({} as any) // UPDATE payments
      .mockResolvedValueOnce({} as any) // UPDATE orders
      .mockResolvedValueOnce({ user_id: 'u1', order_number: 'N1', total_amount: '99.00' } as any) // order lookup
    await onPaymentFailed({ order_id: 'rzp_o', error_code: 'E', method: 'upi' }, ctx())
    expect(queryOne).toHaveBeenCalled()
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', sourceKind: 'contact_failed_payment', sourceRefId: 'ord_1' }))
  })

  it('is a no-op when no matching payment record exists', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    await onPaymentFailed({ order_id: 'rzp_o' }, ctx())
    expect(createAutoTask).not.toHaveBeenCalled()
  })

  it('does not open a task when the order has no user', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord_1' } as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({ user_id: null, order_number: 'N1', total_amount: '1' } as any)
    await onPaymentFailed({ order_id: 'rzp_o' }, ctx())
    expect(createAutoTask).not.toHaveBeenCalled()
  })

  it('swallows a createAutoTask rejection', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord_1' } as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({ user_id: 'u1', order_number: 'N1', total_amount: '9' } as any)
    vi.mocked(createAutoTask).mockRejectedValue(new Error('task db'))
    await expect(onPaymentFailed({ order_id: 'rzp_o' }, ctx())).resolves.toBeUndefined()
    expect(createAutoTask).toHaveBeenCalled()
  })
})

describe('onPaymentLinkPaid', () => {
  it('drops when no store resolves', async () => {
    vi.mocked(storeFor).mockResolvedValue(null)
    await onPaymentLinkPaid({ id: 'pl' }, { id: 'pay' }, ctx())
    expect(applyLinkPayment).not.toHaveBeenCalled()
  })

  it('applies the link payment and records details when matched', async () => {
    vi.mocked(applyLinkPayment).mockResolvedValue('captured' as any)
    await onPaymentLinkPaid({ id: 'pl' }, { id: 'pay' }, ctx())
    expect(applyLinkPayment).toHaveBeenCalledWith({ id: 'pl' }, { id: 'pay' }, store)
    expect(recordPaymentDetails).toHaveBeenCalled()
  })

  it('skips details when unmatched', async () => {
    vi.mocked(applyLinkPayment).mockResolvedValue('unmatched' as any)
    await onPaymentLinkPaid({ id: 'pl' }, { id: 'pay' }, ctx())
    expect(recordPaymentDetails).not.toHaveBeenCalled()
  })
})

describe('onPaymentLinkExpired', () => {
  it('drops when no store', async () => {
    vi.mocked(storeFor).mockResolvedValue(null)
    await onPaymentLinkExpired({ id: 'pl' }, ctx())
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('marks the order link expired', async () => {
    await onPaymentLinkExpired({ id: 'pl' }, ctx())
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("payment_link_status = 'expired'"), ['pl'])
  })
})

describe('onPaymentCaptured: UPI QR payments', () => {
  it('finds the QR of an orderless UPI payment and finalises its QR intent (qr_code.credited fallback)', async () => {
    const all = vi.fn(async () => ({ items: [{ id: 'qr_1', notes: { payment_intent_id: 'i1' } }] }))
    vi.mocked(getRazorpayInstance).mockReturnValue({ qrCode: { all } } as any)
    vi.mocked(applyQrIntentPayment).mockResolvedValue('paid')
    const pay = { id: 'pay_q', amount: 500, method: 'upi', order_id: null }
    const r = await onPaymentCaptured(pay, ctx())
    expect(all).toHaveBeenCalledWith({ payment_id: 'pay_q' })
    expect(applyQrIntentPayment).toHaveBeenCalledWith({ id: 'qr_1', notes: { payment_intent_id: 'i1' } }, pay, store)
    expect(r).toBe('paid')
    expect(inPaymentStore).not.toHaveBeenCalled()
  })

  it("reads the QR on a store's own account for an own-key event", async () => {
    const all = vi.fn(async () => ({ items: [{ id: 'qr_1' }] }))
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { qrCode: { all } } } as any)
    vi.mocked(applyQrIntentPayment).mockResolvedValue('already_paid')
    const r = await onPaymentCaptured({ id: 'pay_q', method: 'upi' }, ctx({ source: 'own', store }))
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
    expect(r).toBe('already_paid')
  })

  it('falls through to the order path when no QR took the payment or Razorpay fails', async () => {
    vi.mocked(getRazorpayInstance).mockReturnValue({ qrCode: { all: vi.fn(async () => ({ items: [] })) } } as any)
    vi.mocked(applyCapturedPayment).mockResolvedValue('unmatched' as any)
    expect(await onPaymentCaptured({ id: 'p1', method: 'upi' }, ctx())).toBe('unmatched')
    vi.mocked(getRazorpayInstance).mockImplementation(() => {
      throw new Error('no keys')
    })
    expect(await onPaymentCaptured({ id: 'p2', method: 'upi' }, ctx())).toBe('unmatched')
    expect(inPaymentStore).toHaveBeenCalledTimes(2)
  })

  it('falls through when the QR is neither an intent nor an invoice QR', async () => {
    vi.mocked(getRazorpayInstance).mockReturnValue({ qrCode: { all: vi.fn(async () => ({ items: [{ id: 'qr_x' }] })) } } as any)
    vi.mocked(applyQrPayment).mockResolvedValue('unmatched' as any)
    vi.mocked(applyCapturedPayment).mockResolvedValue('unmatched' as any)
    expect(await onPaymentCaptured({ id: 'p3', method: 'upi' }, ctx())).toBe('unmatched')
    expect(inPaymentStore).toHaveBeenCalled()
  })
})

describe('onQrCodeCredited', () => {
  it('finalises a QR intent first and leaves the invoice QR alone', async () => {
    vi.mocked(applyQrIntentPayment).mockResolvedValue('paid')
    expect(await onQrCodeCredited({ id: 'qr' }, { id: 'pay' }, ctx())).toBe('paid')
    expect(applyQrIntentPayment).toHaveBeenCalledWith({ id: 'qr' }, { id: 'pay' }, store)
    expect(applyQrPayment).not.toHaveBeenCalled()
  })

  it('returns when qr has no id', async () => {
    await onQrCodeCredited({}, { id: 'pay' }, ctx())
    expect(storeFor).not.toHaveBeenCalled()
  })

  it('drops when no store', async () => {
    vi.mocked(storeFor).mockResolvedValue(null)
    await onQrCodeCredited({ id: 'qr' }, { id: 'pay' }, ctx())
    expect(applyQrPayment).not.toHaveBeenCalled()
  })

  it('applies the qr payment and records details when matched', async () => {
    vi.mocked(applyQrPayment).mockResolvedValue('captured' as any)
    await onQrCodeCredited({ id: 'qr' }, { id: 'pay' }, ctx())
    expect(applyQrPayment).toHaveBeenCalledWith({ id: 'qr' }, { id: 'pay' }, store)
    expect(recordPaymentDetails).toHaveBeenCalled()
  })

  it('skips details when unmatched', async () => {
    vi.mocked(applyQrPayment).mockResolvedValue('unmatched' as any)
    await onQrCodeCredited({ id: 'qr' }, { id: 'pay' }, ctx())
    expect(recordPaymentDetails).not.toHaveBeenCalled()
  })
})
