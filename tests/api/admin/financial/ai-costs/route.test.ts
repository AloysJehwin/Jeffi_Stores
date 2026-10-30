import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/financial/ai-costs/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', role: 'manager', scopes: ['financial:read'] }
const req = (qs = '', tenant?: string) =>
  new NextRequest(`http://localhost/api/admin/financial/ai-costs${qs}`, tenant ? { headers: { 'x-tenant-id': tenant } } : undefined)

describe('GET /api/admin/financial/ai-costs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(admin as any)
    vi.mocked(queryOne).mockResolvedValue({ calls: '5', cost_inr: '4.5', price_inr: '12', failed: '1', unpaid: '2' } as any)
    vi.mocked(queryMany).mockImplementation(async (sql: string) => {
      if (sql.includes('AS b')) return [{ b: '2026-10-02', k: 'google', v: '6' }] as any
      if (sql.includes('GROUP BY ref')) return [{ ref: 'p1', feature: 'product_image', calls: '2', cost_inr: '3', price_inr: '6' }] as any
      if (sql.includes('provider AS key')) return [{ key: 'google', calls: '3', cost_inr: '4', price_inr: '10', failed: '0' }] as any
      return [{ key: 'image', calls: '3', cost_inr: '4', price_inr: '10', failed: '0' }] as any
    })
  })

  it('is gated on financial:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('rejects a bad range', async () => {
    expect((await GET(req('?from=2026-10-10&to=2026-10-01'))).status).toBe(400)
  })

  it('labels the flagship as platform cost', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.flagship).toBe(true)
    expect(j.current).toEqual({ calls: 5, cost_inr: 4.5, price_inr: 12, failed: 1, unpaid: 2 })
    expect(j.providers).toEqual(['google'])
    expect(j.series).toHaveLength(10)
    expect(j.series[1]).toMatchObject({ label: '2026-10-02', google: 6 })
    expect(j.top_refs[0]).toMatchObject({ ref: 'p1', price_inr: 6 })
    const seriesSql = vi.mocked(queryMany).mock.calls.find(c => String(c[0]).includes('AS b'))![0]
    expect(seriesSql).toContain('SUM(cost_inr)')
  })

  it('charts wallet charges on a tenant', async () => {
    const j = await (await GET(req('', '11111111-1111-1111-1111-111111111111'))).json()
    expect(j.flagship).toBe(false)
    const seriesSql = vi.mocked(queryMany).mock.calls.find(c => String(c[0]).includes('AS b'))![0]
    expect(seriesSql).toContain('price_inr')
  })
})
