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

import { GET, POST } from '@/app/api/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId]/units/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = { id: 'prod-1', variantId: 'var-1', subVariantId: 'sv-1' }
const baseUrl = 'http://localhost/api/admin/products/prod-1/variants/var-1/sub-variants/sv-1/units'

function makeGetReq() {
  return new NextRequest(baseUrl)
}

function makePostReq(body: unknown) {
  return new NextRequest(baseUrl, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.resetAllMocks() })

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe('GET /api/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId]/units', () => {
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

  it('returns 404 when sub-variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Sub-variant/)
  })

  it('returns empty units when none exist', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.units).toEqual([])
  })

  it('returns units on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const units = [
      { id: 'u1', unit: 'pc', factor: 1, is_base: true },
      { id: 'u2', unit: 'box', factor: 10, is_base: false },
    ]
    mockQueryMany.mockResolvedValue(units)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.units).toEqual(units)
  })
})

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId]/units', () => {
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

  it('returns 404 when sub-variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const req = new NextRequest(baseUrl, {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/JSON/i)
  })

  it('returns 400 when unit is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const res = await POST(makePostReq({ unit: '', factor: 1 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unit/)
  })

  it('returns 400 when factor is zero', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const res = await POST(makePostReq({ unit: 'pc', factor: 0 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/factor/)
  })

  it('returns 400 when factor is negative', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const res = await POST(makePostReq({ unit: 'pc', factor: -5 }), { params })
    expect(res.status).toBe(400)
  })

  it('creates unit on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const newUnit = { id: 'u1', unit: 'pc', factor: 1, sub_variant_id: 'sv-1' }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [newUnit] }),
    }))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.unit).toEqual(newUnit)
  })

  it('clears base flags before inserting when is_base=true', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const newUnit = { id: 'u1', unit: 'pc', factor: 1, is_base: true }
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })     // UPDATE SET is_base=FALSE
      .mockResolvedValueOnce({ rows: [newUnit] }) // INSERT
    mockWithTx.mockImplementation(async (fn: any) => fn({ query: clientQuery }))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1, is_base: true }), { params })
    expect(res.status).toBe(201)
    expect(clientQuery).toHaveBeenCalledTimes(2)
  })

  it('uses count dimension by default for unknown dimension value', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    const newUnit = { id: 'u1', unit: 'kg', factor: 1, dimension: 'count' }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [newUnit] }),
    }))
    const res = await POST(makePostReq({ unit: 'kg', factor: 1, dimension: 'invalid' }), { params })
    expect(res.status).toBe(201)
  })

  it('accepts valid dimension values', async () => {
    for (const dim of ['count', 'length', 'area', 'volume', 'weight', 'custom']) {
      vi.resetAllMocks()
      mockAuth.mockResolvedValue(admin)
      mockHasScope.mockReturnValue(true)
      mockQueryOne.mockResolvedValue({ id: 'sv-1' })
      mockWithTx.mockImplementation(async (fn: any) => fn({
        query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1', dimension: dim }] }),
      }))
      const res = await POST(makePostReq({ unit: 'u', factor: 1, dimension: dim }), { params })
      expect(res.status).toBe(201)
    }
  })

  it('sets min_qty to 1 when invalid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1', min_qty: 1 }] }),
    }))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1, min_qty: -5 }), { params })
    expect(res.status).toBe(201)
  })

  it('stores conversion_meta as JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1', conversion_meta: { ratio: 12 } }] }),
    }))
    const res = await POST(makePostReq({ unit: 'dozen', factor: 12, conversion_meta: { ratio: 12 } }), { params })
    expect(res.status).toBe(201)
  })

  it('returns 409 on duplicate key error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    mockWithTx.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/)
  })

  it('returns 500 on unexpected db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sv-1' })
    mockWithTx.mockRejectedValue(new Error('connection lost'))
    const res = await POST(makePostReq({ unit: 'pc', factor: 1 }), { params })
    expect(res.status).toBe(500)
  })
})
