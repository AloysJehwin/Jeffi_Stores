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

import { PATCH, DELETE } from '@/app/api/admin/products/[id]/variants/[variantId]/units/[unitId]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1', variantId: 'var-1', unitId: 'unit-1' })
const baseUrl = 'http://localhost/api/admin/products/prod-1/variants/var-1/units/unit-1'

function makePatchReq(body: unknown) {
  return new NextRequest(baseUrl, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDeleteReq() {
  return new NextRequest(baseUrl, { method: 'DELETE' })
}

beforeEach(() => { vi.resetAllMocks() })

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/variants/[variantId]/units/[unitId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    // First queryOne call is ensureVariant
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Variant/)
  })

  it('returns 404 when unit not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' }) // variant exists
      .mockResolvedValueOnce(null)             // unit not found
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Unit/)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const req = new NextRequest(baseUrl, {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/JSON/i)
  })

  it('returns 400 when unit is empty string', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ unit: '' }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unit/)
  })

  it('returns 400 when factor is zero', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ factor: 0 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/factor/)
  })

  it('returns 400 when factor is negative', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ factor: -2 }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when dimension is invalid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ dimension: 'time' }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/dimension/)
  })

  it('returns 400 when min_qty is not positive', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ min_qty: -1 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/min_qty/)
  })

  it('returns 400 when max_qty is not positive', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ max_qty: 0 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/max_qty/)
  })

  it('returns 400 when qty_step is not positive', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const res = await PATCH(makePatchReq({ qty_step: 0 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/qty_step/)
  })

  it('updates unit on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const updated = { id: 'unit-1', unit: 'box', factor: 10 }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [updated] }),
    }))
    const res = await PATCH(makePatchReq({ unit: 'box', factor: 10 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(updated)
  })

  it('sets is_base and clears others when is_base=true', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const updated = { id: 'unit-1', is_base: true }
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })     // UPDATE SET is_base=FALSE for variant
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE SET ... RETURNING
    mockWithTx.mockImplementation(async (fn: any) => fn({ query: clientQuery }))
    const res = await PATCH(makePatchReq({ is_base: true }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(updated)
  })

  it('returns current row when no fields sent and is_base=false', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    const current = { id: 'unit-1', unit: 'pc', factor: 1 }
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [current] }),
    }))
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unit).toEqual(current)
  })

  it('sets display_label to null when empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'unit-1', display_label: null }] }),
    }))
    const res = await PATCH(makePatchReq({ display_label: '' }), { params })
    expect(res.status).toBe(200)
  })

  it('sets max_qty to NULL when null sent', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'unit-1', max_qty: null }] }),
    }))
    const res = await PATCH(makePatchReq({ max_qty: null }), { params })
    expect(res.status).toBe(200)
  })

  it('sets conversion_meta to NULL when null sent', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'unit-1', conversion_meta: null }] }),
    }))
    const res = await PATCH(makePatchReq({ conversion_meta: null }), { params })
    expect(res.status).toBe(200)
  })

  it('stores conversion_meta as JSON object', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'unit-1', conversion_meta: { r: 5 } }] }),
    }))
    const res = await PATCH(makePatchReq({ conversion_meta: { r: 5 } }), { params })
    expect(res.status).toBe(200)
  })

  it('returns 409 on duplicate key error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const res = await PATCH(makePatchReq({ unit: 'box' }), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/)
  })

  it('returns 500 on unknown db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
    mockWithTx.mockRejectedValue(new Error('connection reset'))
    const res = await PATCH(makePatchReq({ unit: 'box' }), { params })
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/variants/[variantId]/units/[unitId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null) // ensureVariant
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Variant/)
  })

  it('returns 404 when unit not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' }) // variant
      .mockResolvedValueOnce(null)             // unit not found
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Unit/)
  })

  it('returns 400 when base unit has siblings', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: true })
      .mockResolvedValueOnce({ id: 'unit-2' }) // sibling exists
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/base unit/)
  })

  it('deletes base unit when it is the only variant unit', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: true })
      .mockResolvedValueOnce(null)             // no sibling
      .mockResolvedValueOnce({ rowCount: 1 })  // DELETE
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('deletes non-base unit successfully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'unit-1', is_base: false })
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
