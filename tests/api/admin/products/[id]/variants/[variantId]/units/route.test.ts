import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

import { GET, POST } from '@/app/api/admin/products/[id]/variants/[variantId]/units/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, withTransaction, query as dbQuery } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1', variantId: 'var-1' })

function makeGetReq() {
  return new NextRequest(`http://localhost/api/admin/products/prod-1/variants/var-1/units`)
}
function makePostReq(body: any) {
  return new NextRequest(`http://localhost/api/admin/products/prod-1/variants/var-1/units`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // assertUnitChangeAllowed reads product flags via query(); default to a
  // non-serialized, non-perishable product so the guard is a no-op unless a
  // test opts in.
  vi.mocked(dbQuery).mockResolvedValue({ rows: [{ perishable: false, serialized: false }] } as any)
})

describe('GET /api/admin/products/[id]/variants/[variantId]/units', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns variant-level units on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'var-1' })
    const units = [{ id: 'u1', unit: 'pc', factor: 1, is_base: true }]
    mockQueryMany.mockResolvedValueOnce(units).mockResolvedValueOnce([]) // units then rules
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.units).toEqual(units)
    expect(body.inherited).toBe(false)
  })

  it('falls back to product-level units when no variant units', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'var-1' })
    const productUnits = [{ id: 'u2', unit: 'box', factor: 10 }]
    mockQueryMany
      .mockResolvedValueOnce([]) // variant units empty
      .mockResolvedValueOnce(productUnits) // product units
      .mockResolvedValueOnce([]) // rules
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.inherited).toBe(true)
    expect(body.units).toEqual(productUnits)
  })
})

describe('POST /api/admin/products/[id]/variants/[variantId]/units', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 400 when unit missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ factor: 1 }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when factor is zero', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ unit: 'pc', factor: 0 }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(404)
  })

  it('creates unit on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'var-1' })
    const newUnit = { id: 'u1', unit: 'pc', factor: 1 }
    // is_base not set → only one client.query call (the INSERT RETURNING)
    mockWithTx.mockImplementation(async (fn: any) =>
      fn({
        query: vi.fn().mockResolvedValueOnce({ rows: [newUnit] }),
      })
    )
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(newUnit)
  })

  it('creates base unit on happy path (is_base=true)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'var-1' })
    const newUnit = { id: 'u2', unit: 'box', factor: 10, is_base: true }
    // is_base=true → UPDATE first, then INSERT RETURNING
    mockWithTx.mockImplementation(async (fn: any) =>
      fn({
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] }) // UPDATE set is_base = false
          .mockResolvedValueOnce({ rows: [newUnit] }), // INSERT RETURNING
      })
    )
    const res = await POST(makePostReq({ unit: 'box', factor: 10, is_base: true }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(newUnit)
  })

  it('returns 409 when base unit constraint violated', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'var-1' })
    mockWithTx.mockRejectedValueOnce(new Error('uniq_product_units_one_base_per_variant'))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1, is_base: true }), { params })
    expect(res.status).toBe(409)
  })
})
