import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), resolveRequestTenant: vi.fn(async () => null) }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/payments/refund-records', () => ({ applyRefundEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/razorpay-events/payments', () => ({ onPaymentCaptured: vi.fn() }))
vi.mock('@/lib/payments/capture', () => ({ applyCapturedPayment: vi.fn(), applyLinkPayment: vi.fn(), applyQrPayment: vi.fn() }))
vi.mock('@/lib/channels/sync-run', () => ({
  withChannelLock: vi.fn(async (_c: string, _l: string, _k: string, fn: any) => {
    const counts: Record<string, number> = {}
    const errors: any[] = []
    await fn({ errors, step: async (n: string, run: any) => void (counts[n] = await run()) })
    return { id: '1', status: 'success', counts, errors }
  }),
}))

import { sweepRazorpay, razorpayPaidBeforeCancel } from '@/lib/payments/rzp-sweep'
import { queryMany, queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { applyRefundEvent } from '@/lib/payments/refund-records'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { onPaymentCaptured } from '@/lib/payments/razorpay-events/payments'
import { applyCapturedPayment, applyLinkPayment, applyQrPayment } from '@/lib/payments/capture'

const now = () => Math.floor(Date.now() / 1000)
const inst = {
  payments: { all: vi.fn(), fetch: vi.fn() },
  refunds: { fetch: vi.fn() },
  orders: { fetchPayments: vi.fn() },
  paymentLink: { fetch: vi.fn() },
  qrCode: { fetchAllPayments: vi.fn(), fetch: vi.fn() },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: inst } as any)
  vi.mocked(controlPlanePool).mockReturnValue({ query: vi.fn(async () => ({ rows: [{ payment_id: 'pay_store' }] })) } as any)
})

describe('sweepRazorpay', () => {
  it('applies captured payments with no record and flags what it cannot place', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'platform', tenantId: null, slug: null, ownFlag: false })
    inst.payments.all.mockResolvedValueOnce({
      items: [
        { id: 'pay_new', status: 'captured', amount: 50000 },
        { id: 'pay_lost', status: 'captured', amount: 7000 },
        { id: 'pay_store', status: 'captured', amount: 100 },
        { id: 'pay_inv', status: 'captured', invoice_id: 'inv_1' },
        { id: 'pay_done', status: 'captured' },
        { id: 'pay_auth', status: 'authorized', amount: 900, created_at: now() - 3600 },
        { id: 'pay_fresh', status: 'authorized', created_at: now() - 60 },
        { id: 'pay_fail', status: 'failed' },
      ],
    })
    vi.mocked(queryOne).mockImplementation(async (_s: string, p?: any[]) => (p?.[0] === 'pay_done' ? ({ '?column?': 1 } as any) : null))
    vi.mocked(onPaymentCaptured).mockImplementation(async (p: any) => (p.id === 'pay_new' ? 'paid' : 'unmatched'))
    inst.refunds.fetch.mockResolvedValue({ status: 'processed' })
    vi.mocked(queryMany).mockResolvedValue([{ razorpay_refund_id: 'rfnd_1' }] as any)

    const r = await sweepRazorpay()

    expect(vi.mocked(onPaymentCaptured).mock.calls.map(c => (c[0] as any).id)).toEqual(['pay_new', 'pay_lost'])
    expect(r.counts).toEqual({ recovered: 1, refunds: 1 })
    const types = vi.mocked(createAdminNotification).mock.calls.map(c => [c[0].type, c[0].entityId])
    expect(types).toEqual([
      ['razorpay_unmatched_payment', 'pay_lost'],
      ['razorpay_uncaptured_payment', 'pay_auth'],
    ])
    expect(applyRefundEvent).toHaveBeenCalledWith('refund.processed', { status: 'processed' }, null)
  })

  it('only polls refunds for a Route store, whose payments the flagship sweeps', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route', tenantId: 't1', slug: 's', ownFlag: false })
    inst.refunds.fetch.mockResolvedValue({ status: 'pending' })
    vi.mocked(queryMany).mockResolvedValue([{ razorpay_refund_id: 'rfnd_1' }] as any)
    const r = await sweepRazorpay()
    expect(inst.payments.all).not.toHaveBeenCalled()
    expect(r.counts).toEqual({ refunds: 0 })
  })

  it('applies an own-key store’s payments in that store', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own', tenantId: 't1', slug: 's', ownFlag: true })
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 's' } as any)
    inst.payments.all.mockResolvedValueOnce({ items: [{ id: 'pay_1', status: 'captured' }] })
    vi.mocked(onPaymentCaptured).mockResolvedValue('committed' as any)
    await sweepRazorpay()
    expect(vi.mocked(onPaymentCaptured).mock.calls[0][1]).toMatchObject({ source: 'own', store: { tenantId: 't1', slug: 's' } })
  })
})

describe('razorpayPaidBeforeCancel', () => {
  it('is unpaid when nothing was sent to Razorpay', async () => {
    await expect(razorpayPaidBeforeCancel({ rzp_order_id: null, payment_link_id: null, razorpay_qr_id: null })).resolves.toBe('unpaid')
  })

  it('applies a captured order payment', async () => {
    inst.orders.fetchPayments.mockResolvedValue({ items: [{ id: 'pay_1', status: 'captured' }] })
    vi.mocked(applyCapturedPayment).mockResolvedValue('paid' as any)
    await expect(razorpayPaidBeforeCancel({ rzp_order_id: 'order_1', payment_link_id: null, razorpay_qr_id: null })).resolves.toBe('paid')
  })

  it('applies a paid link or QR, and is unknown when Razorpay cannot be asked', async () => {
    inst.paymentLink.fetch.mockResolvedValue({ status: 'paid', payments: [{ payment_id: 'pay_2', status: 'captured' }] })
    inst.payments.fetch.mockResolvedValue({ id: 'pay_2' })
    await expect(razorpayPaidBeforeCancel({ rzp_order_id: null, payment_link_id: 'plink_1', razorpay_qr_id: null })).resolves.toBe('paid')
    expect(applyLinkPayment).toHaveBeenCalled()

    inst.qrCode.fetchAllPayments.mockResolvedValue({ items: [{ id: 'pay_3', status: 'captured' }] })
    inst.qrCode.fetch.mockResolvedValue({ id: 'qr_1' })
    await expect(razorpayPaidBeforeCancel({ rzp_order_id: null, payment_link_id: null, razorpay_qr_id: 'qr_1' })).resolves.toBe('paid')
    expect(applyQrPayment).toHaveBeenCalled()

    inst.orders.fetchPayments.mockRejectedValue(new Error('down'))
    await expect(razorpayPaidBeforeCancel({ rzp_order_id: 'order_1', payment_link_id: null, razorpay_qr_id: null })).resolves.toBe('unknown')
  })
})
