import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/products/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/products/overview${qs}`)

describe('GET /api/admin/products/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['products:read'] } as any)
    vi.mocked(queryOne).mockResolvedValue(null)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on products:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period and attention', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.period).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(Array.isArray(j.attention)).toBe(true)
    const withPeriod = vi.mocked(queryMany).mock.calls.find(c => Array.isArray(c[1]) && c[1].length >= 2)
    expect(withPeriod?.[1]?.slice(0, 2)).toEqual(['2026-10-01', '2026-10-10'])
  })

  it('falls back to 30 days on a bad range', async () => {
    const j = await (await GET(req('?from=2026-10-10&to=2026-10-01'))).json()
    expect(j.period.from <= j.period.to).toBe(true)
  })

  it('returns 500 when a query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req())).status).toBe(500)
  })
})

describe('products overview shape', () => {
  it('maps health, periods and price changes', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['products:read'] } as any)
    vi.mocked(queryOne).mockImplementation(async (sql: string) =>
      sql.includes('increases') ? ({ manual: '3', bulk: '1', avg_change: '0.1' } as any) : ({ active: '10', no_price: '2', complete: '7' } as any)
    )
    vi.mocked(queryMany).mockImplementation(async (sql: string) => {
      if (sql.includes('unnest(ARRAY[true, false])'))
        return [{ cur: true, sales: '500', units: '5', costed_net: '100', cost: '60' }, { cur: false, sales: '250' }] as any
      return [] as any
    })
    const j = await (await GET(new NextRequest('http://localhost/api/admin/products/overview?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.bucket).toBe('day')
    expect(j.current).toMatchObject({ sales: 500, units: 5, margin: 0.4 })
    expect(j.previousStats.sales).toBe(250)
    expect(j.health).toMatchObject({ active: 10, no_price: 2, complete: 7 })
    expect(j.health.samples.no_price).toEqual([])
    expect(j.priceChanges).toMatchObject({ manual: 3, bulk: 1, avgChange: 0.1 })
    expect(j.attention.map((a: any) => a.key)).toContain('no_price')
  })
})
