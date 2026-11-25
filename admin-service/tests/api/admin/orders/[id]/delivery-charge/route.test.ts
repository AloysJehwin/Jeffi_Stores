import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({ fetchDelhiveryInvoiceCharges: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getBusinessValues: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ tenantShipsOnPlatform: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/delivery-charge/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { fetchDelhiveryInvoiceCharges } from '@/lib/shipping/delhivery'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { tenantShipsOnPlatform } from '@/lib/payments/wallet'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'o1' }),
  })
const order = {
  awb_number: 'AWB1',
  order_number: 'ORD-1',
  payment_mode: 'cod',
  shipping_amount: '60',
  dest_pin: '110001',
  delhivery_charged_weight_kg: null,
  delhivery_billed_at: null,
}

describe('POST /api/admin/orders/[id]/delivery-charge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(tenantShipsOnPlatform).mockResolvedValue(false)
    vi.mocked(getBusinessValues).mockResolvedValue({ delhiveryOriginPincode: '600001' } as never)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ chargedAmount: 10 })).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ chargedAmount: 10 })).status).toBe(403)
  })

  it('returns 409 for a store that ships on the platform account', async () => {
    vi.mocked(tenantShipsOnPlatform).mockResolvedValue(true)
    expect((await call({ chargedAmount: 10 })).status).toBe(409)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 503 when the delivery account cannot be read', async () => {
    vi.mocked(tenantShipsOnPlatform).mockResolvedValue(null as never)
    expect((await call({ chargedAmount: 10 })).status).toBe(503)
  })

  it('returns 400 when neither weight nor amount is given', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ chargedWeightKg: -1 })).status).toBe(400)
  })

  it('returns 404 for a missing order, 400 without AWB or pincode', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect((await call({ chargedAmount: 10 })).status).toBe(404)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...order, awb_number: null })
    expect((await call({ chargedAmount: 10 })).status).toBe(400)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...order, dest_pin: null })
    expect((await call({ chargedAmount: 10 })).status).toBe(400)
  })

  it('stores an entered amount verbatim without calling the rate API', async () => {
    vi.mocked(queryOne).mockResolvedValue(order)
    const res = await call({ chargedAmount: 95.5, proofNote: 'dash' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, charged: 95.5, quoted: 60, source: 'entered', difference: 35.5, breakdown: null })
    expect(fetchDelhiveryInvoiceCharges).not.toHaveBeenCalled()
    const params = vi.mocked(query).mock.calls[0][1] as unknown[]
    expect(params).toEqual(['o1', null, 95.5, null, null, null, true])
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'o1', metadata: expect.objectContaining({ source: 'entered', proofNote: 'dash' }) }))
  })

  it('prices a weight through the rate API with the COD payment type', async () => {
    vi.mocked(queryOne).mockResolvedValue(order)
    vi.mocked(fetchDelhiveryInvoiceCharges).mockResolvedValue({ total: 120, freight: 100, codCharge: 20, oda: 0, tax: 0, zone: 'N' } as never)
    const res = await call({ chargedWeightKg: 1.25 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ charged: 120, source: 'calculated', chargedWeightKg: 1.25 })
    expect(fetchDelhiveryInvoiceCharges).toHaveBeenCalledWith({
      awb: 'AWB1',
      settledStatus: 'Delivered',
      chargedWeightG: 1250,
      originPin: '600001',
      destPin: '110001',
      paymentType: 'COD',
    })
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['o1', 1.25, 120, 100, 20, 0, true])
  })

  it('returns 502 when the rate API gives no price', async () => {
    vi.mocked(queryOne).mockResolvedValue(order)
    vi.mocked(fetchDelhiveryInvoiceCharges).mockResolvedValue(null)
    expect((await call({ chargedWeightKg: 1 })).status).toBe(502)
    expect(query).not.toHaveBeenCalled()
  })
})
