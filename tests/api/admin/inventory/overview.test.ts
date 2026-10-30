import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => null) }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), query: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/inventory/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

const req = (q = '') => new NextRequest(`https://admin.jeffistores.in/api/admin/inventory/overview${q}`)

const stockRow = {
  totals: {
    skus: '10', in_stock: '6', low: '2', out: '4', negative: '1', units: '120.000', value_cost: '5000.00', value_retail: '7000',
    value_estimated: '1000', no_cost: '2', units_sold: '30', units_sold_prev: '15', cogs: '1000', cogs_prev: '500', dead_count: '1', dead_value: '200',
  },
  by_category: [{ label: 'Bolts', value: '5000' }],
  top_skus: [],
  reorder: [
    { product_id: 'p1', variant_id: null, sub_variant_id: null, name: 'Bolt', leaf_name: null, sku: 'B1', qty: '2', sold: '30', unit_cost: '10', lead_time_days: null, moq: null },
    { product_id: 'p2', variant_id: null, sub_variant_id: null, name: 'Nut', leaf_name: null, sku: 'N1', qty: '500', sold: '30', unit_cost: '1', lead_time_days: null, moq: null },
  ],
  selling_out: [], negative: [], no_cost: [], dead: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'admin', scopes: [] } as any)
})

describe('GET /api/admin/inventory/overview', () => {
  it('requires inventory:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'inventory:read')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns the summary with previous-period comparison and reorder suggestions', async () => {
    vi.mocked(queryOne).mockImplementation(async (sql: string) => {
      if (sql.includes('WITH leaves')) return stockRow as any
      if (sql.includes('generate_series')) return { totals: { in: '50', out: '30', in_prev: '20', out_prev: '10', events: '8', events_prev: '4' }, by_type: [], daily: [] } as any
      if (sql.includes('purchase_orders')) return { totals: { open_count: '3', open_value: '900', overdue_count: '1' }, overdue: [], trend: [], active_suppliers: '2' } as any
      return { expiring: [], recent: [] } as any
    })
    const res = await GET(req('?from=2026-09-01&to=2026-09-30'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-02', prevTo: '2026-08-31', days: 30 })
    expect(body.stock).toMatchObject({ valueCost: 5000, low: 2, out: 4, noCost: 2 })
    expect(body.sales.turnover).toBeCloseTo(0.2)
    expect(body.sales.daysOfCover).toBeCloseTo(150)
    expect(body.movements).toMatchObject({ in: 50, inPrev: 20 })
    expect(body.po).toMatchObject({ openCount: 3, overdueCount: 1, activeSuppliers: 2 })
    expect(body.reorder.map((r: any) => r.product_id)).toEqual(['p1'])
    expect(body.reorder[0].suggestedQty).toBe(42)
    const stockCall = vi.mocked(queryOne).mock.calls.find(c => String(c[0]).includes('WITH leaves'))!
    expect(stockCall[1]).toEqual(['2026-09-01', '2026-09-30', '2026-08-02', '2026-08-31', 30])
  })

  it('reports query failures as 500', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
