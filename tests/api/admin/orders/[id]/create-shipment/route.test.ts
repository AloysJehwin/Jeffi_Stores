import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), query: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/gst', () => ({ round2: (n: number) => Math.round(n * 100) / 100 }))
vi.mock('@/lib/shipping', () => ({
  computeShipmentDims: vi.fn(() => ({ chargedWeightGrams: 500, breadth_cm: 10, height_cm: 5, length_cm: 15 })),
}))
vi.mock('@/lib/sms', () => ({ sendOrderShippedSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/site-controls', () => ({
  getBusinessValues: vi.fn().mockResolvedValue({
    delhiveryOriginPincode: '492001',
    pickupLocation: 'JeffiStores',
    sellerName: 'Jeffi Stores',
    sellerAddress: 'Raipur',
    sellerPhone: '9999999999',
  }),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/create-shipment/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query, queryMany } from '@/lib/db'
import { sendOrderShippedSMS } from '@/lib/sms'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }
const ORDER_ID = 'order-uuid-1'

function makeReq() {
  return new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/create-shipment`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const params = { params: Promise.resolve({ id: ORDER_ID }) }

const baseOrder = {
  id: ORDER_ID,
  order_number: 'ORD-001',
  awb_number: null,
  total_amount: '1500',
  postal_code: '492001',
  full_name: 'Alice',
  customer_name: null,
  consignee_phone: '9876543210',
  customer_phone: null,
  address_line1: '123 Main',
  address_line2: 'Apt 4',
  landmark: null,
  city: 'Raipur',
  state: 'Chhattisgarh',
  payment_mode: 'prepaid',
  payment_status: 'paid',
  created_at: '2026-01-01T00:00:00Z',
}

function okCreateResponse(pkg: any = { waybill: 'AWB999', sort_code: 'RIP' }) {
  return { ok: true, status: 200, json: async () => ({ packages: [pkg] }) }
}

describe('POST /api/admin/orders/[id]/create-shipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 409 when order already has an AWB', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...baseOrder, awb_number: 'AWB-EXISTING' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(409)
    expect((await res.json()).awb).toBe('AWB-EXISTING')
  })

  it('returns 422 when pincode is invalid', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...baseOrder, postal_code: '12' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/pincode/i)
  })

  it('happy path: creates shipment, updates order, no SMS when channel not sms', async () => {
    mockQueryOne
      .mockResolvedValueOnce(baseOrder) // order lookup
      .mockResolvedValueOnce({ phone: '9876543210', notification_channel: 'email' }) // sms customer
    mockQueryMany.mockResolvedValue([
      {
        quantity: '2',
        variant_id: null,
        variant_name: '',
        weight_grams: '500',
        package_type: 'flat_poly_auto',
        length_cm: '10',
        breadth_cm: '5',
        height_cm: '3',
      },
    ] as any)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okCreateResponse()) // create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tat: 3 }) }) // TAT lookup

    const res = await POST(makeReq(), params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.awb).toBe('AWB999')
    expect(body.sortCode).toBe('RIP')
    expect(body.estimatedDeliveryDate).toBeTruthy()
    expect(mockQuery).toHaveBeenCalled()
    expect(sendOrderShippedSMS).not.toHaveBeenCalled()
  })

  it('sends SMS when customer notification channel is sms', async () => {
    mockQueryOne
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValueOnce({ phone: '9876543210', notification_channel: 'sms' })
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okCreateResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tat: 0 }) }) // tat 0 → no EDD

    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    expect(sendOrderShippedSMS).toHaveBeenCalled()
  })

  it('swallows SMS send failure (fire-and-forget catch)', async () => {
    vi.mocked(sendOrderShippedSMS).mockRejectedValueOnce(new Error('sms down'))
    mockQueryOne
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValueOnce({ phone: '9876543210', notification_channel: 'sms' })
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse()).mockResolvedValueOnce({ ok: false })

    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(sendOrderShippedSMS).toHaveBeenCalled()
  })

  it('order item rows with missing dims/fields use fallbacks in map', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder).mockResolvedValueOnce(null)
    // rows with null package_type / dims / non-numeric qty & weight → map fallbacks
    mockQueryMany.mockResolvedValue([
      {
        quantity: null,
        variant_id: null,
        variant_name: '',
        weight_grams: null,
        package_type: null,
        length_cm: null,
        breadth_cm: null,
        height_cm: null,
      },
    ] as any)
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse()).mockResolvedValueOnce({ ok: false })

    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('COD order ships as COD with collectable amount', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ ...baseOrder, payment_mode: 'cod', payment_status: 'pending' })
      .mockResolvedValueOnce(null) // no sms customer
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse()).mockResolvedValueOnce({ ok: false }) // TAT lookup non-ok → no EDD

    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    // decode the urlencoded data param
    const decoded = JSON.parse(
      decodeURIComponent((vi.mocked(global.fetch).mock.calls[0][1] as any).body.split('data=')[1])
    )
    expect(decoded.shipments[0].payment_mode).toBe('COD')
    expect(decoded.shipments[0].cod_amount).toBe('1500')
  })

  it('returns 502 when Delhivery API returns non-ok / no packages', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ rmk: 'server error' }),
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(502)
    expect((await res.json()).details).toBe('server error')
  })

  it('returns 502 with default detail when data has no rmk', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ packages: [] }),
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(502)
    expect((await res.json()).details).toMatch(/unknown error/i)
  })

  it('returns 422 when package status is Fail', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okCreateResponse({ status: 'Fail', remarks: ['bad pin', 'no service'] }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(422)
    expect((await res.json()).details).toMatch(/bad pin; no service/)
  })

  it('returns 422 when package has err_code', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse({ err_code: 'E101' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('E101')
  })

  it('returns 502 when no AWB (waybill) returned', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse({ waybill: '', sort_code: 'RIP' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/no awb/i)
  })

  it('proceeds without EDD when TAT lookup throws', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder).mockResolvedValueOnce(null)
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse()).mockRejectedValueOnce(new Error('TAT down'))

    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.estimatedDeliveryDate).toBeNull()
  })

  it('reads TAT from array shape and falls back on missing consignee fields', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        ...baseOrder,
        full_name: null,
        customer_name: null, // → 'Customer'
        consignee_phone: null,
        customer_phone: null, // → default 9999999999
        order_number: null, // baseRef uses id slice
        city: null,
        state: null,
      })
      .mockResolvedValueOnce(null)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okCreateResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => [{ tat: 2 }] }) // array shape tat

    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.estimatedDeliveryDate).toBeTruthy()
  })

  it('normalizes a 12-digit 91-prefixed phone to 10 digits', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...baseOrder, consignee_phone: '919876543210' }).mockResolvedValueOnce(null)
    global.fetch = vi.fn().mockResolvedValueOnce(okCreateResponse()).mockResolvedValueOnce({ ok: false })

    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    const decoded = JSON.parse(
      decodeURIComponent((vi.mocked(global.fetch).mock.calls[0][1] as any).body.split('data=')[1])
    )
    expect(decoded.shipments[0].phone).toBe('9876543210')
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db crash'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db crash/i)
  })

  it('returns 500 with generic message when a non-Error is thrown', async () => {
    mockQueryOne.mockRejectedValueOnce('boom')
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/internal server error/i)
  })
})

describe('POST /api/admin/orders/[id]/create-shipment minimal order', () => {
  const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['orders'] }

  const minimalOrder = {
    id: 'ord-1',
    order_number: 'ORD-001',
    total_amount: '500',
    full_name: 'John Doe',
    address_line1: '123 Main St',
    address_line2: null,
    landmark: null,
    city: 'Raipur',
    state: 'Chhattisgarh',
    postal_code: '492001',
    consignee_phone: '9999999999',
    customer_phone: '9999999999',
    awb_number: null,
    created_at: new Date().toISOString(),
  }

  function makeReqFor(id: string) {
    return new NextRequest(`http://localhost/api/admin/orders/${id}/create-shipment`, {
      method: 'POST',
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 500 on unexpected db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB crash'))
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(500)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 409 when AWB already set', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...minimalOrder, awb_number: 'AWB123' })
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(409)
  })

  it('returns 422 when postal code invalid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...minimalOrder, postal_code: '123' })
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(422)
  })

  it('returns 502 when Delhivery API fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(minimalOrder)
    mockQueryMany.mockResolvedValue([])
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ rmk: 'API Error' }),
    } as any)
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(502)
  })

  it('returns AWB on successful shipment creation', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(minimalOrder)
    mockQueryMany.mockResolvedValue([])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        packages: [{ waybill: 'AWB999', sort_code: 'RIP', status: 'Success', err_code: null, remarks: [] }],
      }),
    } as any)
    const res = await POST(makeReqFor('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.awb).toBe('AWB999')
  })
})
