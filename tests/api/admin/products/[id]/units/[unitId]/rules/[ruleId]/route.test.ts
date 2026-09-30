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

import { PATCH, DELETE } from '@/app/api/admin/products/[id]/units/[unitId]/rules/[ruleId]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1', unitId: 'unit-1', ruleId: 'rule-1' })

function makePatchReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/products/prod-1/units/unit-1/rules/rule-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDeleteReq() {
  return new NextRequest('http://localhost/api/admin/products/prod-1/units/unit-1/rules/rule-1', {
    method: 'DELETE',
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/units/[unitId]/rules/[ruleId]', () => {
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
    mockQueryOne.mockResolvedValueOnce(null) // ensureRule returns null → false
    const res = await PATCH(makePatchReq({ config: {} }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' })
    const req = new NextRequest('http://localhost/api/admin/products/prod-1/units/unit-1/rules/rule-1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/JSON/i)
  })

  it('returns 400 when no fields to update are sent', async () => {
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
    mockQueryOne
      .mockResolvedValueOnce({ id: 'rule-1' }) // ensureRule
      .mockResolvedValueOnce({ id: 'rule-1', config: { tiers: [] } }) // UPDATE RETURNING
    const res = await PATCH(makePatchReq({ config: { tiers: [] } }), { params })
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
    mockQueryOne.mockResolvedValueOnce({ id: 'rule-1' }).mockResolvedValueOnce({ id: 'rule-1', priority: 50 })
    const res = await PATCH(makePatchReq({ priority: 50 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toBeDefined()
  })

  it('updates all three fields at once', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'rule-1' })
      .mockResolvedValueOnce({ id: 'rule-1', config: { buy: 5, get_extra: 2 }, is_active: true, priority: 10 })
    const res = await PATCH(makePatchReq({ config: { buy: 5, get_extra: 2 }, is_active: true, priority: 10 }), {
      params,
    })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/units/[unitId]/rules/[ruleId]', () => {
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
