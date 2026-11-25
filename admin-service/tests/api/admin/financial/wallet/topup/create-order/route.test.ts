import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: vi.fn(), isRazorpayEnabled: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/financial/wallet/topup/create-order/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/payments/razorpay'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['delhivery'] }
const create = vi.fn()
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/financial/wallet/topup/create-order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? 'not json' : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 'abcdef12-0000', slug: 'acme' } as any)
  vi.mocked(isRazorpayEnabled).mockResolvedValue(true)
  vi.mocked(getRazorpayInstance).mockReturnValue({ orders: { create } } as any)
  create.mockResolvedValue({ id: 'order_1' })
})

describe('POST /api/admin/financial/wallet/topup/create-order', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ amountInr: 1000 }))).status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })

  it('returns 403 without delhivery:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({ amountInr: 1000 }))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['delhivery'], 'delhivery:write')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns 400 without a tenant context', async () => {
    vi.mocked(resolveTenant).mockResolvedValue(null as any)
    expect((await POST(req({ amountInr: 1000 }))).status).toBe(400)
  })

  it('returns 400 when online payments are off', async () => {
    vi.mocked(isRazorpayEnabled).mockResolvedValue(false)
    const res = await POST(req({ amountInr: 1000 }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it.each([[{ amountInr: 0 }], [{ amountInr: -50 }], [{ amountInr: 'abc' }], [{}], [undefined]])('returns 400 for a non-positive amount (%j)', async (body) => {
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'amountInr must be positive' })
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a platform order for credit + 18% GST in paise and returns the breakdown', async () => {
    const res = await POST(req({ amountInr: 1000 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      razorpayOrderId: 'order_1',
      amount: 118000,
      currency: 'INR',
      key_id: 'rzp_test_key',
      credit: 1000,
      gst: 180,
      total: 1180,
    })
    const arg = create.mock.calls[0][0]
    expect(arg.amount).toBe(118000)
    expect(arg.currency).toBe('INR')
    expect(arg.receipt).toMatch(/^wtop-abcdef12-/)
    expect(arg.receipt.length).toBeLessThanOrEqual(40)
    expect(arg.notes).toMatchObject({ purpose: 'wallet_topup', tenant_id: 'abcdef12-0000' })
  })

  it('rounds fractional amounts to whole paise', async () => {
    const res = await POST(req({ amountInr: 333.33 }))
    const body = await res.json()
    expect(body.gst).toBe(60)
    expect(body.total).toBe(393.33)
    expect(body.amount).toBe(39333)
  })

  it('returns 500 with the Razorpay description when the order fails', async () => {
    create.mockRejectedValue({ error: { description: 'Rate limited' } })
    const res = await POST(req({ amountInr: 500 }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Rate limited' })
  })
})
