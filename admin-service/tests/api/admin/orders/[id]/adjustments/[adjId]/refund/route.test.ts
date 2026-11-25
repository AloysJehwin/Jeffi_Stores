import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), query: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ isRazorpayEnabled: vi.fn() }))
vi.mock('@/lib/payments/refund', () => ({
  externalRefundCeiling: vi.fn(),
  recordExternalRefund: vi.fn(),
  refundAcrossPayments: vi.fn(),
}))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn(() => Promise.resolve()) }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/adjustments/[adjId]/refund/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { isRazorpayEnabled } from '@/lib/payments/razorpay'
import { externalRefundCeiling, recordExternalRefund, refundAcrossPayments } from '@/lib/payments/refund'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (body: unknown = {}, qs = '') =>
  POST(
    new NextRequest(`http://localhost/x${qs}`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'o1', adjId: 'adj1' }) }
  )
const order = { order_number: 'ORD-1', user_id: 'u1', original_order_id: null }

function claim(amount: string | null) {
  vi.mocked(queryOne).mockResolvedValueOnce(amount === null ? null : ({ amount } as never)).mockResolvedValueOnce(order)
}

describe('POST /api/admin/orders/[id]/adjustments/[adjId]/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockReset()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isRazorpayEnabled).mockResolvedValue(true as never)
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1' } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 400 when the gateway is not configured', async () => {
    vi.mocked(isRazorpayEnabled).mockResolvedValue(false as never)
    expect((await call()).status).toBe(400)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid external refund method', async () => {
    const res = await call({ external: { method: 'nope' } })
    expect(res.status).toBe(400)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 409 when the refund is already issued', async () => {
    claim(null)
    expect((await call()).status).toBe(409)
    expect(refundAcrossPayments).not.toHaveBeenCalled()
  })

  it('refunds the exact claimed amount through the gateway', async () => {
    claim('149.50')
    vi.mocked(refundAcrossPayments).mockResolvedValue({ refunds: [{ id: 'rf1', amount: 149.5 }] } as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, refunded: 149.5, refunds: [{ id: 'rf1', amount: 149.5 }] })
    expect(refundAcrossPayments).toHaveBeenCalledWith({
      orderId: 'o1',
      amount: 149.5,
      orderRef: 'ORD-1',
      purpose: 'order_adjustment',
      tenantId: 't1',
    })
    const last = vi.mocked(query).mock.calls.at(-1)!
    expect(last[0]).toMatch(/UPDATE order_adjustments SET refunds/)
    expect(last[1]).toEqual([JSON.stringify([{ id: 'rf1', amount: 149.5 }]), 'adj1'])
  })

  it('refunds against the original order for the legacy variant change', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ amount: '20' } as never)
      .mockResolvedValueOnce({ ...order, original_order_id: 'orig' })
    vi.mocked(refundAcrossPayments).mockResolvedValue({ refunds: [{ id: 'rf9' }] } as never)
    await call({}, '?legacy=1')
    expect(refundAcrossPayments).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'orig', amount: 20, purpose: 'variant_change' }))
    expect(vi.mocked(query).mock.calls.at(-1)![1]).toEqual(['rf9', 'adj1'])
  })

  it('releases the claim and returns 502 when nothing was refunded', async () => {
    claim('10')
    vi.mocked(refundAcrossPayments).mockRejectedValue(Object.assign(new Error('gateway down'), { refunds: [] }))
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('gateway down')
    expect(vi.mocked(query).mock.calls.at(-1)![0]).toMatch(/refund_status = 'pending'/)
  })

  it('keeps the partial refunds recorded when some already went out', async () => {
    claim('10')
    vi.mocked(refundAcrossPayments).mockRejectedValue(Object.assign(new Error('half'), { refunds: [{ id: 'rf1' }] }))
    expect((await call()).status).toBe(502)
    expect(vi.mocked(query).mock.calls.at(-1)![1]).toEqual([JSON.stringify([{ id: 'rf1' }]), 'adj1'])
  })

  it('records an external refund without calling the gateway', async () => {
    vi.mocked(isRazorpayEnabled).mockResolvedValue(false as never)
    claim('75')
    vi.mocked(externalRefundCeiling).mockResolvedValue(100)
    const res = await call({ external: { method: 'bank_transfer', reference: 'UTR1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      refunded: 75,
      external: { method: 'bank_transfer', reference: 'UTR1', note: null },
    })
    expect(recordExternalRefund).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', amount: 75, purpose: 'order_adjustment', actorId: 'a1', tenantId: 't1' })
    )
    expect(refundAcrossPayments).not.toHaveBeenCalled()
  })

  it('rejects an external refund above the ceiling and releases the claim', async () => {
    claim('75')
    vi.mocked(externalRefundCeiling).mockResolvedValue(50)
    const res = await call({ external: { method: 'upi' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/50\.00/)
    expect(recordExternalRefund).not.toHaveBeenCalled()
    expect(vi.mocked(query).mock.calls.at(-1)![0]).toMatch(/refund_status = 'pending'/)
  })

  it('rejects a Razorpay-only external method on an order with no Razorpay payment', async () => {
    claim('5')
    vi.mocked(externalRefundCeiling).mockResolvedValue(null)
    const res = await call({ external: { method: 'razorpay_dashboard' } })
    expect(res.status).toBe(400)
    expect(recordExternalRefund).not.toHaveBeenCalled()
  })
})
