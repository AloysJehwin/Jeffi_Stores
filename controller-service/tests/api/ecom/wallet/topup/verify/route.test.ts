import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const m = vi.hoisted(() => ({ ownerApi: vi.fn(), fetch: vi.fn(), credit: vi.fn(), start: vi.fn() }))
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: m.ownerApi }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => ({ orders: { fetch: m.fetch } }) }))
vi.mock('@/lib/billing/topup', () => ({ creditTopup: m.credit }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ startStoreIfReady: m.start }))

import { POST } from '@controller/app/api/(ecom)/ecom/wallet/topup/verify/route'

const SECRET = 'test-secret'
const sign = (o: string, p: string) => crypto.createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex')
const body = (over: Record<string, unknown> = {}) => ({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_1', 'pay_1'), ...over })
const req = (b: unknown) => new NextRequest('https://ecom.test/api/ecom/wallet/topup/verify', { method: 'POST', body: JSON.stringify(b) })
const ORDER = { amount: 59000, amount_paid: 59000, notes: { purpose: 'wallet_topup', tenant_id: 't-1' } }

describe('POST ecom wallet topup verify', () => {
  const prev = process.env.RAZORPAY_KEY_SECRET
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_KEY_SECRET = SECRET
    m.ownerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' } })
    m.fetch.mockResolvedValue(ORDER)
    m.credit.mockResolvedValue({ ok: true, balance: 500 })
    m.start.mockResolvedValue(true)
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.RAZORPAY_KEY_SECRET
    else process.env.RAZORPAY_KEY_SECRET = prev
  })

  it('passes through the auth rejection', async () => {
    m.ownerApi.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req(body()))).status).toBe(401)
  })

  it('400s missing fields, a bad signature and a missing secret', async () => {
    expect((await POST(req({ razorpay_order_id: 'order_1' }))).status).toBe(400)
    const bad = await POST(req(body({ razorpay_signature: 'deadbeef' })))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('Invalid payment signature')
    delete process.env.RAZORPAY_KEY_SECRET
    expect((await POST(req(body()))).status).toBe(400)
    expect(m.credit).not.toHaveBeenCalled()
  })

  it('400s an order that belongs to another wallet', async () => {
    m.fetch.mockResolvedValue({ ...ORDER, notes: { purpose: 'wallet_topup', tenant_id: 'other' } })
    expect((await POST(req(body()))).status).toBe(400)
    expect(m.credit).not.toHaveBeenCalled()
  })

  it('credits the wallet from the order amount and starts a waiting store', async () => {
    const res = await POST(req(body()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, balance: 500, started: true })
    expect(m.credit).toHaveBeenCalledWith({ tenantId: 't-1', paymentId: 'pay_1', paidPaise: 59000, notes: ORDER.notes })
    expect(m.start).toHaveBeenCalledWith('t-1')
  })

  it('500s when the credit fails', async () => {
    m.credit.mockResolvedValue({ ok: false, error: 'db down' })
    const res = await POST(req(body()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
    expect(m.start).not.toHaveBeenCalled()
  })
})
