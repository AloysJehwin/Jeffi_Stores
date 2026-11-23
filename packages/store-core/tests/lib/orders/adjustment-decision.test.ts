import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })), queryOne: vi.fn(), resolveRequestTenant: vi.fn(async () => ({ tenantId: 't1', slug: 'acme' })) }))
vi.mock('@/lib/shared/db', () => db)
const rzp = vi.hoisted(() => ({
  isRazorpayEnabled: vi.fn(async () => true),
  getRazorpayInstanceFor: vi.fn(async () => ({
    instance: { orders: { create: vi.fn(async () => ({ id: 'rzp_order_1' })) } },
    creds: { key_id: 'key_abc' },
  })),
}))
vi.mock('@/lib/payments/razorpay', () => rzp)
vi.mock('@/lib/replies/context', () => ({ closeReplyContexts: vi.fn(async () => {}) }))
const adj = vi.hoisted(() => ({ applyAdjustment: vi.fn(async () => ({ applied: true })) }))
vi.mock('@/lib/orders/adjustments', () => adj)

import { confirmAdjustment, rejectAdjustment, loadOpenAdjustment } from '@/lib/orders/adjustment-decision'
import { queryOne, query } from '@/lib/shared/db'
import { applyAdjustment } from '@/lib/orders/adjustments'
import { closeReplyContexts } from '@/lib/replies/context'

const open = (over: Record<string, any> = {}) => ({
  id: 'adj1',
  order_id: 'o1',
  order_number: 'ORD-1',
  user_id: 'u1',
  status: 'pending_customer',
  order_status: 'confirmed',
  awb_number: null,
  original_order_id: null,
  net_diff: '-150',
  settlement_type: 'refund',
  razorpay_order_id: null,
  ...over,
})

beforeEach(() => {
  vi.mocked(applyAdjustment).mockResolvedValue({ applied: true } as any)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

describe('confirmAdjustment guards', () => {
  it('404 when the adjustment is missing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 404, error: 'Change request not found.' })
  })
  it('403 when it belongs to another user', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ user_id: 'other' }))
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 403, error: 'This order does not belong to you.' })
  })
  it('409 when no longer open', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ status: 'applied' }))
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 409, error: 'This change is no longer open.' })
  })
  it('400 when the order has moved to fulfilment (awb set)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ awb_number: 'AWB1' }))
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 400, error: 'This order can no longer be changed (it has moved to fulfilment).' })
  })
  it('400 when the order is not confirmed', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ order_status: 'processing' }))
    expect((await confirmAdjustment('adj1', 'o1', 'u1')).ok).toBe(false)
  })
})

describe('confirmAdjustment settlements', () => {
  it('refund: applies and marks refund pending', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'refund' }))
    const r = await confirmAdjustment('adj1', 'o1', 'u1')
    expect(r).toEqual({ ok: true, settlement: 'refund_pending' })
    expect(applyAdjustment).toHaveBeenCalledWith('adj1')
    expect(closeReplyContexts).toHaveBeenCalledWith('orders', 'o1', 'order_adjustment')
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain("refund_status = 'pending'")
    expect(params).toEqual(['adj1'])
  })

  it('refund: 409 when apply fails for a real reason', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'refund' }))
    vi.mocked(applyAdjustment).mockResolvedValueOnce({ applied: false, reason: 'stock_gone' } as any)
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 409, error: 'Could not apply the change: stock_gone' })
  })

  it('refund: already_applied is treated as success', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'refund' }))
    vi.mocked(applyAdjustment).mockResolvedValueOnce({ applied: false, reason: 'already_applied' } as any)
    expect((await confirmAdjustment('adj1', 'o1', 'u1')).ok).toBe(true)
  })

  it('collect: opens a razorpay order with the abs amount in paise', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'collect', net_diff: '150.50' }))
    const r = await confirmAdjustment('adj1', 'o1', 'u1')
    // amount 150.50 -> 15050 paise
    expect(r).toEqual({ ok: true, settlement: 'collect', razorpayOrderId: 'rzp_order_1', amount: 15050, currency: 'INR', keyId: 'key_abc' })
    const { getRazorpayInstanceFor } = await import('@/lib/payments/razorpay')
    const createFn = (await vi.mocked(getRazorpayInstanceFor).mock.results[0].value).instance.orders.create
    expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ amount: 15050, currency: 'INR' }))
    // persists the awaiting_payment status
    expect(vi.mocked(query).mock.calls[0][0]).toContain("status = 'awaiting_payment'")
  })

  it('collect: reuses an existing razorpay order id without creating', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'collect', net_diff: '-100', razorpay_order_id: 'rzp_existing' }))
    const r = await confirmAdjustment('adj1', 'o1', 'u1')
    expect(r).toEqual({ ok: true, settlement: 'collect', razorpayOrderId: 'rzp_existing', amount: 10000, currency: 'INR', keyId: 'key_abc' })
    expect(query).not.toHaveBeenCalled() // no status update when reusing
  })

  it('collect: 400 when razorpay is disabled', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'collect' }))
    rzp.isRazorpayEnabled.mockResolvedValueOnce(false)
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 400, error: 'Payment gateway not configured.' })
  })

  it('cod_adjust/none: applies and echoes the settlement type', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'cod_adjust' }))
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: true, settlement: 'cod_adjust' })
    expect(applyAdjustment).toHaveBeenCalledWith('adj1')
  })

  it('none: 409 when apply fails', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open({ settlement_type: 'none' }))
    vi.mocked(applyAdjustment).mockResolvedValueOnce({ applied: false, reason: 'boom' } as any)
    expect(await confirmAdjustment('adj1', 'o1', 'u1')).toEqual({ ok: false, status: 409, error: 'Could not apply the change: boom' })
  })
})

describe('loadOpenAdjustment', () => {
  it('selects the adjustment joined to the order', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(open())
    await loadOpenAdjustment('adj1', 'o1')
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toContain('FROM order_adjustments a JOIN orders o')
    expect(params).toEqual(['adj1', 'o1'])
  })
})

describe('rejectAdjustment', () => {
  it('rejects an open adjustment and closes contexts', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'adj1' })
    const r = await rejectAdjustment('adj1', 'o1', 'u1')
    expect(r).toBe(true)
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toContain("status = 'rejected'")
    expect(params).toEqual(['adj1', 'o1', 'u1'])
    expect(closeReplyContexts).toHaveBeenCalledWith('orders', 'o1', 'order_adjustment')
  })
  it('returns false and skips closing when nothing matched', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await rejectAdjustment('adj1', 'o1', 'u1')).toBe(false)
    expect(closeReplyContexts).not.toHaveBeenCalled()
  })
})
