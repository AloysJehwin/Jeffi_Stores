import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const confirmAdjustment = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/orders/adjustment-decision', () => ({ confirmAdjustment }))

import { POST } from '@storefront/app/api/(public)/orders/[id]/adjustments/[adjId]/confirm/route'

const post = () =>
  POST(new NextRequest('http://localhost/api/orders/o1/adjustments/a1/confirm', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', adjId: 'a1' }),
  })

describe('POST /api/orders/[id]/adjustments/[adjId]/confirm', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    confirmAdjustment.mockResolvedValue({ ok: true, settlement: 'refund' })
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(confirmAdjustment).not.toHaveBeenCalled()
  })

  it('passes the decision error status through', async () => {
    confirmAdjustment.mockResolvedValue({ ok: false, status: 409, error: 'Already decided' })
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Already decided' })
  })

  it('confirms and reports a non-collect settlement', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ success: true, settlement: 'refund' })
    expect(confirmAdjustment).toHaveBeenCalledWith('a1', 'o1', 'u1')
  })

  it('returns the Razorpay order for a collect settlement', async () => {
    confirmAdjustment.mockResolvedValue({ ok: true, settlement: 'collect', razorpayOrderId: 'order_X', amount: 5000, currency: 'INR', keyId: 'rzp_test_k' })
    expect(await (await post()).json()).toEqual({
      success: true,
      settlement: 'collect',
      razorpayOrderId: 'order_X',
      amount: 5000,
      currency: 'INR',
      key_id: 'rzp_test_k',
    })
  })

  it('500s with the gateway description on failure', async () => {
    confirmAdjustment.mockRejectedValue({ error: { description: 'Gateway said no' } })
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Gateway said no')
  })
})
