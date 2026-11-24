import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The real route and change log; only auth and the DB are faked, and every statement is captured.
const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  existing: null as unknown,
  sql: [] as { sql: string; params: unknown[] }[],
  failWrite: false,
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    m.sql.push({ sql, params })
    if (m.failWrite && /amazon_repricer_rules/.test(sql)) throw new Error('db down')
    return { rows: [] }
  }),
  queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    m.sql.push({ sql, params })
    return sql.includes('FROM amazon_repricer_rules') ? m.existing : { id: 'log1' }
  }),
  queryMany: vi.fn(async () => []),
}))

import { PUT, DELETE } from '@admin/app/api/(admin)/admin/amazon/console/rules/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon_pricing:write'] }
const put = (body: unknown) =>
  PUT(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/console/rules', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const del = (id?: string) => DELETE(new NextRequest(`https://acme.jeffistores.in/api/admin/amazon/console/rules${id === undefined ? '' : `?id=${id}`}`, { method: 'DELETE' }))
const deny = (status: number) => NextResponse.json({ error: 'nope' }, { status })
const writes = () => m.sql.filter(s => /^\s*(INSERT INTO|DELETE FROM) amazon_repricer_rules/.test(s.sql))

beforeEach(() => {
  vi.clearAllMocks()
  m.sql = []
  m.existing = null
  m.failWrite = false
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
})

describe('amazon console rules route', () => {
  it('needs amazon_pricing:write and the plan for PUT and DELETE, changing nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(deny(403))
    expect((await put({ sku: 'S1', strategy: 'hold' })).status).toBe(403)
    expect((await del('4')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_pricing:write')
    m.requireAdminScope.mockResolvedValue(deny(401))
    expect((await put({ sku: 'S1', strategy: 'hold' })).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await put({ sku: 'S1', strategy: 'hold' })).status).toBe(403)
    expect((await del('4')).status).toBe(403)
    expect(m.sql).toEqual([])
  })

  it('rejects an invalid rule with 400', async () => {
    const cases = [
      { sku: 'S1', strategy: 'undercut' },
      { sku: 'S1', strategy: 'hold', minMarginPct: 95 },
      { sku: 'S1', strategy: 'hold', minPrice: 500, maxPrice: 400 },
      { sku: '   ', strategy: 'hold' },
      { strategy: 'hold' },
    ]
    for (const body of cases) expect((await put(body)).status).toBe(400)
    expect((await put({ sku: 'S1', strategy: 'hold', minPrice: 500, maxPrice: 400 })).status).toBe(400)
    expect(m.sql).toEqual([])
  })

  it('creates a rule with defaults and logs it as added', async () => {
    const res = await put({ sku: 'S1', strategy: 'beat_buybox', beatBy: 2 })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, summary: 'Added the repricer rule for S1: beat buybox' })
    const [write] = writes()
    expect(write.params).toEqual(['S1', 'beat_buybox', 2, null, null, 5, false, true])
    const log = m.sql.find(s => s.sql.includes('INSERT INTO channel_change_log'))
    expect(log?.params).toEqual(expect.arrayContaining(['amazon', 'a1', 'owner@crm.test', 'repricer.rule', 'S1', 'applied']))
  })

  it('describes a changed default rule that applies automatically', async () => {
    m.existing = { strategy: 'hold' }
    const res = await put({ sku: null, strategy: 'match_buybox', autoApply: true, minPrice: 100, maxPrice: 900 })
    expect((await res.json()).summary).toBe('Changed the repricer rule for all SKUs: match buybox, applied automatically')
    expect(writes()[0].params).toEqual([null, 'match_buybox', 0, 100, 900, 5, true, true])
  })

  it('answers 400 with the reason when the write fails', async () => {
    m.failWrite = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await put({ sku: 'S1', strategy: 'hold' })
    expect(res.status).toBe(400)
    expect((await res.json()).problems.join(' ')).toContain('db down')
    expect(m.sql.some(s => s.params.includes('failed') || s.params.includes('rejected'))).toBe(true)
  })

  it('DELETE removes the rule by numeric id and logs it', async () => {
    const res = await del('42')
    expect(res.status).toBe(200)
    expect((await res.json()).summary).toBe('Removed repricer rule 42')
    expect(writes()[0]).toMatchObject({ params: ['42'] })
    expect(m.sql.some(s => s.sql.includes('INSERT INTO channel_change_log'))).toBe(true)
  })

  it('DELETE refuses a missing or non-numeric id with 400', async () => {
    expect((await del()).status).toBe(400)
    expect((await del('4; DROP TABLE x')).status).toBe(400)
    expect((await del('abc')).status).toBe(400)
    expect(writes()).toEqual([])
  })
})
