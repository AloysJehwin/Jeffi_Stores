import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The real route, brand-approval logic and change log; only auth and the DB are faked.
const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  brand: null as null | { status: string | null; name: string },
  listRows: [] as any[],
  sql: [] as { sql: string; params: unknown[] }[],
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => (m.sql.push({ sql, params }), { rows: [] })),
  queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    m.sql.push({ sql, params })
    return sql.includes('FROM brands b LEFT JOIN channel_brand_approvals') ? m.brand : { id: 'log1' }
  }),
  queryMany: vi.fn(async (sql: string, params: unknown[] = []) => (m.sql.push({ sql, params }), sql.includes('GROUP BY b.id') ? m.listRows : [])),
}))

import { GET, PUT } from '@admin/app/api/(admin)/admin/channels/[channel]/brand-approvals/route'

const BRAND = '11111111-1111-4111-8111-111111111111'
const WRITER = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['myntra:read', 'myntra:write', 'amazon:read', 'amazon:write', 'merchant_sync:read'] }
const READER = { ...WRITER, scopes: ['myntra:read'] }
const ctx = (channel: string) => ({ params: Promise.resolve({ channel }) })
const get = (channel: string) => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/brand-approvals`), ctx(channel))
const put = (channel: string, body: unknown) =>
  PUT(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/brand-approvals`, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx(channel))
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })
const approvalWrites = () => m.sql.filter(s => /(INSERT INTO|DELETE FROM) channel_brand_approvals/.test(s.sql))

beforeEach(() => {
  vi.clearAllMocks()
  m.sql = []
  m.brand = { status: null, name: 'Acme Wear' }
  m.listRows = []
  m.requireAdminScope.mockResolvedValue(WRITER)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
})

describe('channels brand-approvals route', () => {
  it('answers 404 for a channel that has no brand gate', async () => {
    expect((await get('razorpay')).status).toBe(404)
    expect((await put('razorpay', { brandId: BRAND, status: 'approved' })).status).toBe(404)
    expect(m.requireAdminScope).not.toHaveBeenCalled()
  })

  it("GET needs the channel's read scope and plan", async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await get('myntra')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'myntra:read')
    m.requireAdminScope.mockResolvedValue(WRITER)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get('myntra')).status).toBe(403)
  })

  it('GET lists every brand with whether it may be pushed (a marketplace needs approval first)', async () => {
    m.listRows = [
      { brand_id: BRAND, brand_name: 'Acme Wear', product_count: 4, status: 'approved' },
      { brand_id: '22222222-2222-4222-8222-222222222222', brand_name: 'Newco', product_count: 2, status: null },
    ]
    const res = await get('myntra')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ channel: 'myntra', requiresApproval: true })
    expect(body.brands.map((b: any) => [b.brandName, b.allowed])).toEqual([['Acme Wear', true], ['Newco', false]])
  })

  it('GET shows an ungated brand as allowed on a channel that does not require approval', async () => {
    m.listRows = [{ brand_id: BRAND, brand_name: 'Acme Wear', product_count: 4, status: null }]
    const body = await (await get('gmc')).json()
    expect(body.requiresApproval).toBe(false)
    expect(body.brands[0].allowed).toBe(true)
  })

  it('PUT needs the write scope of that channel', async () => {
    m.requireAdminScope.mockResolvedValue(READER)
    const res = await put('myntra', { brandId: BRAND, status: 'approved' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    expect(approvalWrites()).toEqual([])
    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await put('myntra', { brandId: BRAND, status: 'approved' })).status).toBe(401)
  })

  it('PUT rejects a bad brand id or status with 400', async () => {
    for (const body of [{}, { brandId: 'not-a-uuid', status: 'approved' }, { brandId: BRAND }, { brandId: BRAND, status: 'maybe' }, 'not json']) {
      const res = await put('myntra', body)
      expect(res.status).toBe(400)
    }
    expect(approvalWrites()).toEqual([])
  })

  it('PUT approves a brand for the channel and logs the change', async () => {
    const res = await put('myntra', { brandId: BRAND, status: 'approved', note: 'Letter received', approvalUrl: 'https://myntra.example/approval/1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'approved' })
    const [write] = approvalWrites()
    expect(write.params.slice(0, 6)).toEqual(['myntra', BRAND, 'approved', 'Letter received', 'https://myntra.example/approval/1', 'owner@crm.test'])
    const log = m.sql.find(s => s.sql.includes('INSERT INTO channel_change_log'))
    expect(log?.params).toEqual(expect.arrayContaining(['myntra', 'brand_approval', BRAND, 'applied']))
  })

  it('PUT drops a non-https approval link and clears an approval with status null', async () => {
    await put('myntra', { brandId: BRAND, status: 'pending', approvalUrl: 'http://insecure.example' })
    expect(approvalWrites()[0].params[4]).toBeNull()
    m.sql = []
    const res = await put('myntra', { brandId: BRAND, status: null })
    expect(res.status).toBe(200)
    expect(approvalWrites()[0]).toMatchObject({ sql: expect.stringContaining('DELETE FROM channel_brand_approvals'), params: ['myntra', BRAND] })
  })

  it('PUT answers 400 when the brand does not exist and writes nothing', async () => {
    m.brand = null
    const res = await put('myntra', { brandId: BRAND, status: 'approved' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Brand not found.')
    expect(approvalWrites()).toEqual([])
  })
})
