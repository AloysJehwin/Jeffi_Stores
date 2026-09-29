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

import { GET, POST } from '@/app/api/admin/products/[id]/units/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction, query as dbQuery} from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1' })

function makeGetReq() {
  return new NextRequest(`http://localhost/api/admin/products/prod-1/units`)
}
function makePostReq(body: any) {
  return new NextRequest(`http://localhost/api/admin/products/prod-1/units`, {
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

describe('GET /api/admin/products/[id]/units', () => {
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

  it('returns 404 when product not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns units and empty rules when no unit ids', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.units).toEqual([])
    expect(body.rules).toEqual([])
  })

  it('returns units and associated rules on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    const units = [{ id: 'u1', unit: 'pc', factor: 1, is_base: true }]
    const rules = [{ id: 'r1', product_unit_id: 'u1', rule_type: 'min_qty' }]
    mockQueryMany
      .mockResolvedValueOnce(units)
      .mockResolvedValueOnce(rules)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.units).toEqual(units)
    expect(body.rules).toEqual(rules)
  })
})

describe('POST /api/admin/products/[id]/units', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest('http://localhost/api/admin/products/prod-1/units', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when unit is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ unit: '', factor: 1 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unit/)
  })

  it('returns 400 when factor is zero', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ unit: 'pc', factor: 0 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/factor/)
  })

  it('returns 400 when factor is negative', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ unit: 'pc', factor: -5 }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when product not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(404)
  })

  it('creates unit on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    const newUnit = { id: 'u1', unit: 'pc', factor: 1, is_base: true }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })          // clear base flags
        .mockResolvedValueOnce({ rows: [newUnit] }),   // insert
    }))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1, is_base: true }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(newUnit)
  })

  it('returns 409 on duplicate unit name', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    mockWithTx.mockImplementation(async () => {
      throw new Error('duplicate key value violates unique constraint uniq_product_units_product_unit')
    })
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(409)
  })

  it('returns 500 on other db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    mockWithTx.mockImplementation(async () => {
      throw new Error('connection error')
    })
    const res = await POST(makePostReq({ unit: 'box', factor: 10 }), { params })
    expect(res.status).toBe(500)
  })

  it('uses custom dimension when provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'prod-1' })
    const newUnit = { id: 'u2', unit: 'kg', factor: 1, dimension: 'weight' }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [newUnit] }),
    }))
    const res = await POST(makePostReq({ unit: 'kg', factor: 1, dimension: 'weight' }), { params })
    expect(res.status).toBe(200)
  })
})
