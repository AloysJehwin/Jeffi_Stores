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

import { PATCH, DELETE } from '@/app/api/admin/products/[id]/variants/[variantId]/units/[unitId]/rules/[ruleId]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1', variantId: 'var-1', unitId: 'unit-1', ruleId: 'rule-1' })
const baseUrl = 'http://localhost/api/admin/products/prod-1/variants/var-1/units/unit-1/rules/rule-1'

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

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/variants/[variantId]/units/[unitId]/rules/[ruleId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq({ config: {} }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({ config: {} }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when rule not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makePatchReq({ config: {} }), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Rule/)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' })
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

  it('returns 400 when no fields to update', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' })
    const res = await PATCH(makePatchReq({}), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No fields/)
  })

  it('updates config on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const updatedRule = { id: 'rule-1', config: { tiers: [{ min_qty: 5, price: 90 }] } }
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce(updatedRule)
    const res = await PATCH(makePatchReq({ config: { tiers: [{ min_qty: 5, price: 90 }] } }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toBeDefined()
  })

  it('updates is_active on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce({ id: 'rule-1', is_active: false })
    const res = await PATCH(makePatchReq({ is_active: false }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toBeDefined()
  })

  it('updates priority on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce({ id: 'rule-1', priority: 75 })
    const res = await PATCH(makePatchReq({ priority: 75 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toBeDefined()
  })

  it('updates all three fields at once', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const updatedRule = { id: 'rule-1', config: { buy: 5, get_extra: 2 }, is_active: true, priority: 10 }
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce(updatedRule)
    const res = await PATCH(makePatchReq({ config: { buy: 5, get_extra: 2 }, is_active: true, priority: 10 }), {
      params,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toEqual(updatedRule)
  })

  it('coerces is_active truthy values to boolean', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce({ id: 'rule-1', is_active: true })
    const res = await PATCH(makePatchReq({ is_active: 1 }), { params })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/variants/[variantId]/units/[unitId]/rules/[ruleId]', () => {
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

  it('returns 404 when rule not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Rule/)
  })

  it('deletes rule successfully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeDeleteReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
