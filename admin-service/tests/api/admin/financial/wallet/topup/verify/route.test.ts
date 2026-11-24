import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: vi.fn() }))
vi.mock('@/lib/billing/topup', () => ({ creditTopup: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/financial/wallet/topup/verify/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { creditTopup } from '@/lib/billing/topup'

const SECRET = 'whsec_test'
const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['delhivery'] }
const fetchOrder = vi.fn()
const sign = (o: string, p: string) => crypto.createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex')
const good = () => ({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_1', 'pay_1') })
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/financial/wallet/topup/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'not json' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  process.env.RAZORPAY_KEY_SECRET = SECRET
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(getRazorpayInstance).mockReturnValue({ orders: { fetch: fetchOrder } } as any)
  fetchOrder.mockResolvedValue({ amount: 118000, amount_paid: 118000, notes: { purpose: 'wallet_topup', tenant_id: 't1' } })
  vi.mocked(creditTopup).mockResolvedValue({ ok: true, balance: 2000 } as any)
})

describe('POST /api/admin/financial/wallet/topup/verify', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good()))).status).toBe(401)
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('returns 403 without delhivery:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good()))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['delhivery'], 'delhivery:write')
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('returns 400 without a tenant context', async () => {
    vi.mocked(resolveTenant).mockResolvedValue(null as any)
    expect((await POST(req(good()))).status).toBe(400)
  })

  it.each([[{}], [{ razorpay_order_id: 'o', razorpay_payment_id: 'p' }], [undefined]])('returns 400 for missing payment fields (%j)', async (body) => {
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing payment fields' })
  })

  it('returns 400 when payments are not configured', async () => {
    delete process.env.RAZORPAY_KEY_SECRET
    const res = await POST(req(good()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Payments not configured' })
  })

  it('rejects a bad signature without crediting', async () => {
    const res = await POST(req({ ...good(), razorpay_signature: 'deadbeef' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid payment signature' })
    expect(fetchOrder).not.toHaveBeenCalled()
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('rejects an order that belongs to another wallet', async () => {
    fetchOrder.mockResolvedValue({ amount: 100, notes: { purpose: 'wallet_topup', tenant_id: 'other' } })
    const res = await POST(req(good()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Order does not belong to this wallet' })
    expect(creditTopup).not.toHaveBeenCalled()
  })

  it('returns 500 when the order cannot be fetched', async () => {
    fetchOrder.mockRejectedValue({ error: { description: 'Gateway down' } })
    const res = await POST(req(good()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gateway down' })
  })

  it('rejects a zero paid amount', async () => {
    fetchOrder.mockResolvedValue({ amount: 0, amount_paid: 0, notes: { purpose: 'wallet_topup', tenant_id: 't1' } })
    const res = await POST(req(good()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Top-up amount must be positive' })
  })

  it('credits the amount paid on the Razorpay order, never a client value', async () => {
    const res = await POST(req({ ...good(), amountInr: 999999 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, balance: 2000 })
    expect(fetchOrder).toHaveBeenCalledWith('order_1')
    expect(creditTopup).toHaveBeenCalledWith({
      tenantId: 't1',
      paymentId: 'pay_1',
      paidPaise: 118000,
      notes: { purpose: 'wallet_topup', tenant_id: 't1' },
    })
  })

  it('falls back to the order amount when amount_paid is empty and flags a repeat credit', async () => {
    fetchOrder.mockResolvedValue({ amount: 50000, amount_paid: 0, notes: { purpose: 'wallet_topup', tenant_id: 't1' } })
    vi.mocked(creditTopup).mockResolvedValue({ ok: true, balance: 500, alreadyCredited: true } as any)
    const res = await POST(req(good()))
    expect(await res.json()).toEqual({ success: true, balance: 500, alreadyCredited: true })
    expect(vi.mocked(creditTopup).mock.calls[0][0].paidPaise).toBe(50000)
  })

  it('returns 500 when crediting fails', async () => {
    vi.mocked(creditTopup).mockResolvedValue({ ok: false, error: 'ledger write failed' } as any)
    const res = await POST(req(good()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'ledger write failed' })
  })
})
