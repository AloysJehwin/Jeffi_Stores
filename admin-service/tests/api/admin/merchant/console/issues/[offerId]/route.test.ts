import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), render: vi.fn(), queryOne: vi.fn(), query: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/shared/db', () => ({ queryOne: m.queryOne, query: m.query, queryMany: vi.fn(async () => []) }))
vi.mock('@/lib/merchant/console-api', () => ({ renderProductIssues: m.render }))

import { GET } from '@admin/app/api/(admin)/admin/merchant/console/issues/[offerId]/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:read'] }
const get = (offerId: string, qs = '') => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/merchant/console/issues/x${qs}`), { params: Promise.resolve({ offerId }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.queryOne.mockResolvedValue(null)
  m.query.mockResolvedValue({ rows: [] })
  m.render.mockResolvedValue([{ title: 'Missing GTIN' }])
})

describe('merchant console issues route', () => {
  it('needs merchant_sync:read and the plan, calling Google for nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get('SKU1')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'merchant_sync:read')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get('SKU1')).status).toBe(403)
    expect(m.render).not.toHaveBeenCalled()
  })

  it('rejects an empty or oversized offer id with 400', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('x'.repeat(201))).status).toBe(400)
    expect(m.render).not.toHaveBeenCalled()
  })

  it('serves a cached explanation without calling Google', async () => {
    m.queryOne.mockResolvedValue({ rendered: [{ title: 'Cached' }], fetched_at: '2026-11-24T08:00:00Z' })
    const res = await get('SKU%201')
    expect(await res.json()).toEqual({ issues: [{ title: 'Cached' }], fetchedAt: '2026-11-24T08:00:00Z', cached: true })
    expect(m.queryOne.mock.calls[0][1]).toEqual(['SKU 1', 6])
    expect(m.render).not.toHaveBeenCalled()
  })

  it('fetches from Google on a miss and caches the result', async () => {
    const res = await get('SKU1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ issues: [{ title: 'Missing GTIN' }], cached: false })
    expect(m.render).toHaveBeenCalledWith('SKU1')
    expect(m.query.mock.calls[0][0]).toContain('INSERT INTO gmc_issue_cache')
    expect(m.query.mock.calls[0][1]).toEqual(['SKU1', JSON.stringify([{ title: 'Missing GTIN' }])])
  })

  it('skips the cache read with ?fresh=1', async () => {
    m.queryOne.mockResolvedValue({ rendered: [], fetched_at: 'x' })
    const res = await get('SKU1', '?fresh=1')
    expect((await res.json()).cached).toBe(false)
    expect(m.queryOne).not.toHaveBeenCalled()
    expect(m.render).toHaveBeenCalledTimes(1)
  })

  it('maps Google failures: not connected 409, upstream 502, and nothing is cached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.render.mockRejectedValueOnce(new m.NotConnected('x'))
    expect((await get('SKU1')).status).toBe(409)
    m.render.mockRejectedValueOnce(Object.assign(new Error('Merchant API down'), { httpStatus: 503 }))
    expect((await get('SKU1')).status).toBe(502)
    expect(m.query).not.toHaveBeenCalled()
  })
})
