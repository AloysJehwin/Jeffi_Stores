import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({ authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  resolveRequestTenant: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  getRazorpayInstanceFor: vi.fn(),
  isRazorpayEnabled: vi.fn(),
}))
vi.mock('@/lib/razorpay-route', () => ({
  reverseTransfersForRefund: vi.fn().mockResolvedValue({ reversedPaise: 0, unrecoveredPaise: 0, perTransfer: [] }),
  recordRefundSettlement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}))
vi.mock('@/lib/variant-change', () => ({ applyVariantChange: vi.fn() }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/orders/[id]/variant-change/confirm/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'
import * as vc from '@/lib/variant-change'
import * as activity from '@/lib/activity'

const USER = { userId: 'user-1' }
const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }

const BASE_VCR = {
  id: 'vcr-abcdefghijklmnopqrstuvwxyz1234567890',
  order_id: 'order-1',
  order_number: 'ORD-1',
  user_id: 'user-1',
  order_status: 'confirmed',
  awb_number: null,
  payment_status: 'paid',
  original_order_id: null,
  price_diff: -20,
  settlement_type: 'refund',
}

function makeReq() {
  return new Request('http://localhost/api/orders/order-1/variant-change/confirm', {
    method: 'POST',
  }) as any
}

function makeRazorpay() {
  return {
    payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_1' }) },
    orders: { create: vi.fn().mockResolvedValue({ id: 'rzp_order_1' }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
  vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
  vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(vc.applyVariantChange).mockResolvedValue({ applied: true } as any)
})

describe('POST variant-change confirm', () => {
  it('401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(401)
  })

  it('404 when no pending request', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(null as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(404)
  })

  it('403 when order belongs to another user', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, user_id: 'other' } as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(403)
  })

  it('400 when order moved to fulfilment (status)', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, order_status: 'processing' } as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(400)
  })

  it('400 when order has awb', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, awb_number: 'AWB1' } as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(400)
  })

  // ── REFUND ─────────────────────────────────────────────────────────────
  describe('refund settlement', () => {
    it('400 when razorpay disabled', async () => {
      vi.mocked(db.queryOne).mockResolvedValueOnce(BASE_VCR as any)
      vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
      expect((await POST(makeReq(), PARAMS)).status).toBe(400)
    })

    it('400 when no payment to refund', async () => {
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(BASE_VCR as any) // vcr
        .mockResolvedValueOnce(null as any) // payment
      expect((await POST(makeReq(), PARAMS)).status).toBe(400)
    })

    it('refunds and applies (gateway_response as string)', async () => {
      const rzp = makeRazorpay()
      vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: rzp as any } as any)
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(BASE_VCR as any)
        .mockResolvedValueOnce({ id: 'pay-1', transaction_id: 'pay_rzp', gateway_response: '{"a":1}' } as any)
      const res = await POST(makeReq(), PARAMS)
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.settlement).toBe('refund')
      expect(body.refundId).toBe('rfnd_1')
      expect(rzp.payments.refund).toHaveBeenCalledWith('pay_rzp', { amount: 2000 })
    })

    it('uses original_order_id when present; gateway_response object', async () => {
      const rzp = makeRazorpay()
      vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: rzp as any } as any)
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce({ ...BASE_VCR, original_order_id: 'orig-9' } as any)
        .mockResolvedValueOnce({ id: 'pay-1', transaction_id: 'pay_rzp', gateway_response: { existing: true } } as any)
      const res = await POST(makeReq(), PARAMS)
      expect(res.status).toBe(200)
      // payment lookup used original_order_id
      expect(vi.mocked(db.queryOne).mock.calls[1][1]).toEqual(['orig-9'])
    })

    it('409 when apply fails after refund', async () => {
      const rzp = makeRazorpay()
      vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: rzp as any } as any)
      vi.mocked(vc.applyVariantChange).mockResolvedValue({ applied: false, reason: 'order_not_eligible' } as any)
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(BASE_VCR as any)
        .mockResolvedValueOnce({ id: 'pay-1', transaction_id: 'pay_rzp', gateway_response: null } as any)
      const res = await POST(makeReq(), PARAMS)
      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain('order_not_eligible')
    })
  })

  // ── COD adjust / none ──────────────────────────────────────────────────
  it('cod_adjust applies immediately', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'cod_adjust', price_diff: 40 } as any)
    const res = await POST(makeReq(), PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.settlement).toBe('cod_adjust')
  })

  it('none applies immediately', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'none', price_diff: 0 } as any)
    const res = await POST(makeReq(), PARAMS)
    expect((await res.json()).settlement).toBe('none')
  })

  it('409 when cod_adjust apply fails', async () => {
    vi.mocked(vc.applyVariantChange).mockResolvedValue({ applied: false, reason: 'item_not_found' } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'none', price_diff: 0 } as any)
    expect((await POST(makeReq(), PARAMS)).status).toBe(409)
  })

  // ── COLLECT ──────────────────────────────────────────────────────────────
  describe('collect settlement', () => {
    it('400 when razorpay disabled', async () => {
      vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'collect', price_diff: 40 } as any)
      vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
      expect((await POST(makeReq(), PARAMS)).status).toBe(400)
    })

    it('400 when nothing to collect (diff 0)', async () => {
      vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'collect', price_diff: 0 } as any)
      expect((await POST(makeReq(), PARAMS)).status).toBe(400)
    })

    it('creates razorpay order + logs activity', async () => {
      const rzp = makeRazorpay()
      vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: rzp as any } as any)
      vi.mocked(activity.logActivity).mockRejectedValueOnce(new Error('log fail'))
      vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'collect', price_diff: 40 } as any)
      const res = await POST(makeReq(), PARAMS)
      const body = await res.json()
      // flush the microtask queue so the .catch(() => {}) handler executes
      await Promise.resolve()
      await new Promise(r => setTimeout(r, 0))
      expect(res.status).toBe(200)
      expect(body.settlement).toBe('collect')
      expect(body.razorpayOrderId).toBe('rzp_order_1')
      expect(body.amount).toBe(4000)
      expect(rzp.orders.create).toHaveBeenCalled()
      expect(activity.logActivity).toHaveBeenCalled()
    })

    it('skips activity log when no user_id and swallows log rejection', async () => {
      const rzp = makeRazorpay()
      vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: rzp as any } as any)
      vi.mocked(activity.logActivity).mockRejectedValueOnce(new Error('log fail'))
      vi.mocked(db.queryOne).mockResolvedValueOnce({
        ...BASE_VCR,
        settlement_type: 'collect',
        price_diff: 40,
        user_id: null,
      } as any)
      const res = await POST(makeReq(), PARAMS)
      expect(res.status).toBe(200)
      expect(activity.logActivity).not.toHaveBeenCalled()
    })
  })

  it('400 for unknown settlement type', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE_VCR, settlement_type: 'weird' } as any)
    const res = await POST(makeReq(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Unknown settlement')
  })

  it('500 with razorpay error.description on thrown error', async () => {
    vi.mocked(db.queryOne).mockRejectedValueOnce({ error: { description: 'gateway boom' } })
    const res = await POST(makeReq(), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('gateway boom')
  })

  it('500 with generic message fallback', async () => {
    vi.mocked(db.queryOne).mockRejectedValueOnce(new Error('plain error'))
    const res = await POST(makeReq(), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('plain error')
  })
})
