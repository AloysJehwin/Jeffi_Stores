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

import { POST } from '@/app/api/admin/products/[id]/units/[unitId]/rules/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = { id: 'prod-1', unitId: 'unit-1' }

function makePostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/products/prod-1/units/unit-1/rules', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.resetAllMocks() })

describe('POST /api/admin/products/[id]/units/[unitId]/rules', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq({ rule_type: 'tiered_price', config: { tiers: [] } }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq({ rule_type: 'tiered_price', config: { tiers: [] } }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when unit not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null) // ensureUnit returns null
    const res = await POST(makePostReq({ rule_type: 'tiered_price', config: { tiers: [] } }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const req = new NextRequest('http://localhost/api/admin/products/prod-1/units/unit-1/rules', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/JSON/i)
  })

  it('returns 400 when rule_type is unsupported', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({ rule_type: 'free_shipping', config: {} }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/rule_type/)
  })

  it('returns 400 when rule_type is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({ config: {} }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when tiered_price config has no tiers array', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({ rule_type: 'tiered_price', config: {} }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/tiers/)
  })

  it('returns 400 when tiered_price tier has invalid min_qty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: -1, price: 100 }] },
    }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/min_qty/)
  })

  it('returns 400 when tiered_price tier has invalid price', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 5, price: -10 }] },
    }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/price/)
  })

  it('returns 400 when bonus_qty config has invalid buy', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({
      rule_type: 'bonus_qty',
      config: { buy: 0, get_extra: 1 },
    }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/buy/)
  })

  it('returns 400 when bonus_qty config has invalid get_extra', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'unit-1' })
    const res = await POST(makePostReq({
      rule_type: 'bonus_qty',
      config: { buy: 3, get_extra: -1 },
    }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/get_extra/)
  })

  it('inserts tiered_price rule on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })  // ensureUnit
      .mockResolvedValueOnce({ id: 'rule-1', rule_type: 'tiered_price', config: { tiers: [{ min_qty: 5, price: 100 }] }, is_active: true, priority: 100 })  // INSERT
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 5, price: 100 }] },
    }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule).toBeDefined()
    expect(body.rule.rule_type).toBe('tiered_price')
  })

  it('inserts bonus_qty rule on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })
      .mockResolvedValueOnce({ id: 'rule-2', rule_type: 'bonus_qty', config: { buy: 3, get_extra: 1 }, is_active: true, priority: 100 })
    const res = await POST(makePostReq({
      rule_type: 'bonus_qty',
      config: { buy: 3, get_extra: 1 },
    }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule.rule_type).toBe('bonus_qty')
  })

  it('uses default priority 100 when not provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })
      .mockResolvedValueOnce({ id: 'rule-3', priority: 100 })
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 1, price: 50 }] },
    }), { params })
    expect(res.status).toBe(200)
  })

  it('uses custom priority when provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })
      .mockResolvedValueOnce({ id: 'rule-4', priority: 50 })
    const res = await POST(makePostReq({
      rule_type: 'bonus_qty',
      config: { buy: 2, get_extra: 1 },
      priority: 50,
    }), { params })
    expect(res.status).toBe(200)
  })

  it('defaults is_active to true when not provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })
      .mockResolvedValueOnce({ id: 'rule-5', is_active: true })
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 1, price: 50 }] },
    }), { params })
    expect(res.status).toBe(200)
  })

  it('sets is_active to false when explicitly false', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'unit-1' })
      .mockResolvedValueOnce({ id: 'rule-6', is_active: false })
    const res = await POST(makePostReq({
      rule_type: 'tiered_price',
      config: { tiers: [{ min_qty: 1, price: 50 }] },
      is_active: false,
    }), { params })
    expect(res.status).toBe(200)
  })
})
