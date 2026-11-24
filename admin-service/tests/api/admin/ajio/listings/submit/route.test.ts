import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The real route, submit logic and brand gate; only auth, the DB, credentials and the AJIO adapter are faked.
const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  resolve: vi.fn(),
  submitListings: vi.fn(),
  rows: [] as any[],
  approvals: [] as { brand_id: string; status: string }[],
  tasks: [] as any[],
  sql: [] as { sql: string; params: unknown[] }[],
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/google-ads/assets', () => ({ fetchImage: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class extends Error {}, resolveMarketplaceCreds: m.resolve }))
vi.mock('@/lib/marketplace/registry', () => ({ getAdapter: () => ({ submitListings: m.submitListings }) }))
vi.mock('@/lib/shared/db', () => {
  const rec = (sql: string, params: unknown[] = []) => m.sql.push({ sql, params })
  const queryMany = vi.fn(async (sql: string, params: unknown[] = []) => {
    rec(sql, params)
    if (sql.includes('WITH u AS')) return m.rows
    if (sql.includes('FROM channel_brand_approvals')) return m.approvals
    if (sql.includes('FROM marketplace_listings WHERE channel')) return m.rows.map(r => ({ id: 'l-' + r.product_id, key: r.product_id + '::' }))
    if (sql.includes('FROM marketplace_listing_tasks')) return m.tasks
    return []
  })
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => (rec(sql, params), { rows: [] })),
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => (rec(sql, params), { id: 'log1' })),
    queryMany,
    withTransaction: (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) }),
  }
})

import { GET, POST } from '@admin/app/api/(admin)/admin/ajio/listings/submit/route'

const OK_BRAND = '11111111-1111-4111-8111-111111111111'
const BAD_BRAND = '22222222-2222-4222-8222-222222222222'
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const unit = (id: string, brand: string | null, sku: string | null) => ({
  level: 'product', product_id: id, variant_id: null, sub_variant_id: null, our_sku: sku, name: 'Tee ' + id.slice(0, 2), price: 499, mrp: 699, qty: 5,
  brand: brand ? 'B-' + brand.slice(0, 2) : null, brand_id: brand, marketplace_sku: null, listing_id: null,
})
const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['ajio:write'] }
const post = (body: unknown) => POST(new NextRequest('https://acme.jeffistores.in/api/admin/ajio/listings/submit', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const key = (id: string) => id + '::'
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.sql = []
  m.tasks = []
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.resolve.mockResolvedValue({ mode: 'sandbox', fields: {} })
  m.submitListings.mockResolvedValue({ taskId: 'task-1' })
  m.approvals = [{ brand_id: OK_BRAND, status: 'approved' }, { brand_id: BAD_BRAND, status: 'not_approved' }]
  m.rows = [unit(P1, OK_BRAND, 'SKU-1'), unit(P2, BAD_BRAND, 'SKU-2'), unit(P3, '33333333-3333-4333-8333-333333333333', 'SKU-3')]
})

describe('ajio listings/submit route', () => {
  it('GET needs ajio:read and lists the recent submit tasks', async () => {
    m.tasks = [{ task_id: 'task-0' }]
    const res = await GET(new NextRequest('https://acme.jeffistores.in/api/admin/ajio/listings/submit'))
    expect(res.status).toBe(200)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:read')
    expect(Array.isArray((await res.json()).tasks)).toBe(true)
  })

  it('rejects a caller without the scope and a plan without AJIO, sending nothing', async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await post({ keys: [key(P1)] })).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:write')
    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await post({ keys: [key(P1)] })).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post({ keys: [key(P1)] })
    expect(res.status).toBe(403)
    expect((await res.json()).upgradeRequired).toBe('pro')
    expect(m.submitListings).not.toHaveBeenCalled()
    expect(m.resolve).not.toHaveBeenCalled()
  })

  it('refuses an empty or malformed pick with 400', async () => {
    const none = await post({ keys: [] })
    expect(none.status).toBe(400)
    expect((await none.json()).error).toBe('Pick the listings to submit.')
    expect((await post({})).status).toBe(400)
    expect(m.submitListings).not.toHaveBeenCalled()
  })

  it('answers 409 when AJIO is not connected', async () => {
    m.resolve.mockResolvedValue(null)
    const res = await post({ keys: [key(P1)] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Connect AJIO first.')
    expect(m.submitListings).not.toHaveBeenCalled()
  })

  it('submits an approved brand and records the task and the submitted status', async () => {
    const res = await post({ keys: [key(P1)] })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, submitted: 1, tasks: ['task-1'], skipped: [] })
    expect(m.submitListings).toHaveBeenCalledTimes(1)
    expect(m.submitListings.mock.calls[0][0].map((r: any) => r.sku)).toEqual(['SKU-1'])
    const task = m.sql.find(s => s.sql.includes('INSERT INTO marketplace_listing_tasks'))
    expect(task?.params.slice(0, 3)).toEqual(['ajio', 'task-1', 1])
    expect(m.sql.some(s => s.sql.includes("SET status = 'submitted'"))).toBe(true)
    expect(m.sql.some(s => s.sql.includes('INSERT INTO channel_change_log'))).toBe(true)
  })

  it('never submits a brand that is not approved for AJIO', async () => {
    const res = await post({ keys: [key(P2)] })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, submitted: 0, tasks: [] })
    expect(body.skipped).toEqual([{ key: key(P2), reason: 'Brand not approved for AJIO' }])
    expect(m.submitListings).not.toHaveBeenCalled()
    expect(m.sql.some(s => s.sql.includes('INSERT INTO marketplace_listing_tasks'))).toBe(false)
  })

  it('holds back a brand with no approval at all and a pending one', async () => {
    m.approvals = [{ brand_id: BAD_BRAND, status: 'pending' }]
    const res = await post({ keys: [key(P1), key(P2), key(P3)] })
    const body = await res.json()
    expect(body.submitted).toBe(0)
    expect(body.skipped.map((s: any) => s.reason)).toEqual(['Brand not approved for AJIO', 'Brand not approved for AJIO', 'Brand not approved for AJIO'])
    expect(m.submitListings).not.toHaveBeenCalled()
  })

  it('submits only the approved units from a mixed pick', async () => {
    const res = await post({ keys: [key(P1), key(P2), key(P3)] })
    const body = await res.json()
    expect(body.submitted).toBe(1)
    expect(body.skipped.map((s: any) => s.key).sort()).toEqual([key(P2), key(P3)].sort())
    expect(m.submitListings.mock.calls.flatMap(c => c[0].map((r: any) => r.sku))).toEqual(['SKU-1'])
  })

  it('answers a marketplace failure with an error and records nothing as submitted', async () => {
    m.submitListings.mockRejectedValue(Object.assign(new Error('AJIO is down'), { httpStatus: 503 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ keys: [key(P1)] })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(m.sql.some(s => s.sql.includes("SET status = 'submitted'"))).toBe(false)
    expect(m.sql.some(s => s.sql.includes('INSERT INTO marketplace_listing_tasks'))).toBe(false)
  })
})
