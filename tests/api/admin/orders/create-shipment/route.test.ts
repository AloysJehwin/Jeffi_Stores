import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shipping', () => ({
  computeShipmentDims: vi.fn().mockReturnValue({
    chargedWeightGrams: 500,
    length_cm: 10,
    breadth_cm: 8,
    height_cm: 5,
  }),
}))

import { POST } from '@/app/api/admin/orders/[id]/create-shipment/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['orders'] }

const baseOrder = {
  id: 'ord-1', order_number: 'ORD-001', total_amount: '500',
  full_name: 'John Doe', address_line1: '123 Main St', address_line2: null, landmark: null,
  city: 'Raipur', state: 'Chhattisgarh', postal_code: '492001',
  consignee_phone: '9999999999', customer_phone: '9999999999',
  awb_number: null, created_at: new Date().toISOString(),
}

function makeReq(id: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/create-shipment`, {
    method: 'POST',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/orders/[id]/create-shipment', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 500 on unexpected db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB crash'))
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(500)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 409 when AWB already set', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...baseOrder, awb_number: 'AWB123' })
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(409)
  })

  it('returns 422 when postal code invalid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...baseOrder, postal_code: '123' })
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(422)
  })

  it('returns 502 when Delhivery API fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(baseOrder)
    mockQueryMany.mockResolvedValue([])
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ rmk: 'API Error' }),
    } as any)
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(502)
  })

  it('returns AWB on successful shipment creation', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(baseOrder)
    mockQueryMany.mockResolvedValue([])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ packages: [{ waybill: 'AWB999', sort_code: 'RIP', status: 'Success', err_code: null, remarks: [] }] }),
    } as any)
    const res = await POST(makeReq('ord-1'), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.awb).toBe('AWB999')
  })
})
