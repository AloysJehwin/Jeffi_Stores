import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/orders/fulfilled-status', () => ({
  fulfilledSql: (alias = 'o') => `${alias ? `${alias}.` : ''}status IN ('delivered', 'granted')`,
}))
vi.mock('@/lib/shared/dashboard-insights', () => ({
  getDashboardInsights: vi.fn().mockResolvedValue({}),
  rangeDays: () => 30,
}))

import { getDashboardAnalytics } from '@/lib/queries/dashboard'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

interface Fixture {
  trend?: Record<string, unknown>[]
  prev?: Record<string, unknown>[]
  conv?: Record<string, unknown>[]
  flow?: Record<string, unknown> | null
}

function setup(f: Fixture) {
  mockQueryOne.mockImplementation((async (sql: string) => {
    if (sql.includes('AS rev_prev')) return { rev: '900', rev_prev: '600', ord: '9', ord_prev: '6', cust: '5', cust_prev: '4' }
    if (sql.includes('AS cancelled')) return f.flow ?? null
    return null
  }) as never)
  mockQueryMany.mockImplementation((async (sql: string) => {
    if (sql.includes('WITH ord AS')) return f.trend ?? []
    if (sql.includes('prev_bucket')) return f.prev ?? []
    if (sql.includes('FROM page_events')) return f.conv ?? []
    return []
  }) as never)
}

const trend = [
  { bucket: 'd1', revenue: '300', orders: '4', paid_orders: '3', customers: '3', units: '8' },
  { bucket: 'd2', revenue: '0', orders: '2', paid_orders: '0', customers: '2', units: '3' },
  { bucket: 'd3', revenue: '600', orders: '3', paid_orders: '2', customers: '2', units: '5' },
]

beforeEach(() => vi.clearAllMocks())

describe('getDashboardAnalytics: DashboardSeries fields', () => {
  it('derives one spark value per trend bucket from the trend rows', async () => {
    setup({ trend })
    const r = await getDashboardAnalytics('7d')
    expect(r.spark.orders).toEqual([4, 2, 3])
    expect(r.spark.aov).toEqual([100, 0, 300])
    expect(r.spark.customers).toEqual([3, 2, 2])
    expect(r.spark.conversion).toHaveLength(r.trend.length)
    expect(r.spark.aov).toEqual(r.trend.map(t => t.aov))
  })

  it('computes the conversion spark as online paid orders per 100 sessions, zero without sessions', async () => {
    setup({
      trend,
      conv: [
        { bucket: 'd1', sessions: '200', online_paid: '3' },
        { bucket: 'd3', sessions: '0', online_paid: '2' },
      ],
    })
    const r = await getDashboardAnalytics('7d')
    expect(r.spark.conversion).toEqual([1.5, 0, 0])
  })

  it('aligns trendPrev to the current buckets and zero-fills the missing ones', async () => {
    setup({
      trend,
      prev: [
        { bucket: 'd1', prev_bucket: 'p1', revenue: '250.5', orders: '3' },
        { bucket: 'd3', prev_bucket: 'p3', revenue: '10', orders: '1' },
      ],
    })
    const r = await getDashboardAnalytics('7d')
    expect(r.trendPrev).toEqual([
      { label: 'p1', revenue: 250.5, orders: 3 },
      { label: '', revenue: 0, orders: 0 },
      { label: 'p3', revenue: 10, orders: 1 },
    ])
  })

  it('shifts the previous window forward by one period in SQL, using the range bucket', async () => {
    setup({ trend })
    await getDashboardAnalytics('90d')
    const sql = mockQueryMany.mock.calls.map(c => String(c[0])).find(s => s.includes('prev_bucket'))!
    expect(sql).toContain("date_trunc('week'")
    expect(sql).toContain("+ ((NOW() - INTERVAL '90 days') - (NOW() - INTERVAL '90 days' - INTERVAL '90 days'))")
    const r = await getDashboardAnalytics('year')
    expect(r.trendBucket).toBe('month')
  })

  it('counts how far the orders placed in the range got', async () => {
    setup({
      flow: { placed: '120', paid: '100', shipped: '90', delivered: '80', cancelled: '6', returned: '3' },
    })
    const r = await getDashboardAnalytics('30d')
    expect(r.flow).toEqual({ placed: 120, paid: 100, shipped: 90, delivered: 80, cancelled: 6, returned: 3 })
    const sql = mockQueryOne.mock.calls.map(c => String(c[0])).find(s => s.includes('AS cancelled'))!
    expect(sql).toContain("status IN ('delivered', 'granted')")
    expect(sql).toContain('shipped_at IS NOT NULL')
  })

  it('returns empty series and a zeroed flow when nothing happened', async () => {
    setup({})
    const r = await getDashboardAnalytics('today')
    expect(r.trendPrev).toEqual([])
    expect(r.spark).toEqual({ orders: [], aov: [], customers: [], conversion: [] })
    expect(r.flow).toEqual({ placed: 0, paid: 0, shipped: 0, delivered: 0, cancelled: 0, returned: 0 })
  })

  it('tolerates null results from the database layer', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const r = await getDashboardAnalytics()
    expect(r.flow.placed).toBe(0)
    expect(r.spark.orders).toEqual([])
  })

  it('leaves the existing fields and their meaning unchanged', async () => {
    setup({ trend })
    const r = await getDashboardAnalytics('7d')
    expect(r.range).toBe('7d')
    expect(r.rangeLabel).toBe('Last 7 days')
    expect(r.trendBucket).toBe('day')
    expect(r.kpis).toMatchObject({
      revenue: 900, revenuePrev: 600, revenuePct: 50, orders: 9, ordersPrev: 6, ordersPct: 50,
      aov: 100, aovPrev: 100, customers: 5, customersPrev: 4,
    })
    expect(r.trend).toEqual([
      { bucket: 'd1', label: 'd1', revenue: 300, orders: 4, paidOrders: 3, customers: 3, units: 8, aov: 100 },
      { bucket: 'd2', label: 'd2', revenue: 0, orders: 2, paidOrders: 0, customers: 2, units: 3, aov: 0 },
      { bucket: 'd3', label: 'd3', revenue: 600, orders: 3, paidOrders: 2, customers: 2, units: 5, aov: 300 },
    ])
    expect(r.insights).toEqual({})
  })
})
