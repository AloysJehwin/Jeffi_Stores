import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), create: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => ({ orders: { create: m.create } }) }))
vi.mock('@/lib/billing/topup', () => ({
  topupAmounts: (n: number) => ({ credit: n, gst: n * 0.18, total: n * 1.18 }),
  topupNotes: (t: { id: string }, n: number) => ({ purpose: 'wallet_topup', tenant_id: t.id, amount: String(n) }),
}))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/create-order/route'

const req = (body: unknown) => new NextRequest('https://ecom.test/api/ecom/wallet/topup/create-order', { method: 'POST', body: JSON.stringify(body) })

describe('POST ecom wallet topup create-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 'tenant-12345678' } })
  })

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req({ amountInr: 500 }))).status).toBe(401)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('rejects an amount under 100', async () => {
    expect((await POST(req({ amountInr: 50 }))).status).toBe(400)
    expect((await POST(req({}))).status).toBe(400)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('creates an order for the GST-inclusive total in paise', async () => {
    m.create.mockResolvedValue({ id: 'order_1', amount: 59000, currency: 'INR' })
    const res = await POST(req({ amountInr: 500 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ orderId: 'order_1', amount: 59000, credit: 500, total: 590 })
    const arg = m.create.mock.calls[0][0]
    expect(arg).toMatchObject({ amount: 59000, currency: 'INR', notes: { purpose: 'wallet_topup', tenant_id: 'tenant-12345678' } })
    expect(arg.receipt.length).toBeLessThanOrEqual(40)
  })

  it('500s with the Razorpay description when order creation fails', async () => {
    m.create.mockRejectedValue({ error: { description: 'Bad request' } })
    const res = await POST(req({ amountInr: 500 }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Bad request')
  })
})
