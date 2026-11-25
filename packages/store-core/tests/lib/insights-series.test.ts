import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

import { getInsightsSeries } from '@/lib/queries/insights-series'
import { insightsToCsv, mondayGrid, parseInsightsQuery, summarize, weekdayAverages, weeklyTotals, type InsightsDay } from '@/lib/insights/series'
import { activityToInsights } from '@/lib/dashboard/activity-insights'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

function setup(today: string, dayRows: Record<string, unknown>[] = [], topRows: Record<string, unknown>[] = []) {
  mockQueryOne.mockResolvedValue({ today } as never)
  mockQueryMany.mockImplementation((async (sql: string) => (sql.includes('ROW_NUMBER') ? topRows : dayRows)) as never)
}

const daySql = () => mockQueryMany.mock.calls.find(c => !String(c[0]).includes('ROW_NUMBER'))!
const dow = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

beforeEach(() => vi.clearAllMocks())

describe('getInsightsSeries', () => {
  it('builds weeks * 7 Monday-aligned days ending this Sunday, with zeros for empty days', async () => {
    setup('2026-11-25', [{ day: '2026-11-24', s0: '3' }])
    const s = await getInsightsSeries({ table: 'orders', dateColumn: 'created_at', weeks: 13 })
    expect(s.days).toHaveLength(91)
    expect(s.from).toBe('2026-08-31')
    expect(s.to).toBe('2026-11-29')
    s.days.forEach((d, i) => expect(dow(d.date)).toBe(i % 7))
    expect(s.today).toBe('2026-11-25')
    expect(s.series).toEqual([{ key: 'count', label: 'Count' }])
    expect(s.days.find(d => d.date === '2026-11-24')!.values).toEqual([3])
    expect(s.days.find(d => d.date === '2026-11-23')!.values).toEqual([0])
    expect(s.filter).toBeNull()
  })

  it('clamps weeks to 1..52 and defaults to 26', async () => {
    setup('2026-11-25')
    expect((await getInsightsSeries({ table: 'orders', dateColumn: 'created_at', weeks: 500 })).days).toHaveLength(52 * 7)
    expect((await getInsightsSeries({ table: 'orders', dateColumn: 'created_at', weeks: 0 })).weeks).toBe(26)
    expect((await getInsightsSeries({ table: 'orders', dateColumn: 'created_at' })).weeks).toBe(26)
  })

  it('buckets timestamptz into Asia/Kolkata days and puts the date bounds after the caller params', async () => {
    setup('2026-11-25')
    await getInsightsSeries({ table: 'return_requests', alias: 'rr', dateColumn: 'created_at', where: 'rr.type = $1 AND rr.status <> $2', params: ['refund', 'rejected'], weeks: 4 })
    const [sql, args] = daySql()
    expect(sql).toContain("(rr.created_at AT TIME ZONE 'Asia/Kolkata')::date")
    expect(sql).toContain("rr.created_at >= ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata'")
    expect(sql).toContain("rr.created_at < ($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'")
    expect(sql).toContain('FROM return_requests rr')
    expect(sql).toContain('AND (rr.type = $1 AND rr.status <> $2)')
    expect(args).toEqual(['refund', 'rejected', '2026-11-02', '2026-11-29'])
  })

  it('uses date columns as they are', async () => {
    setup('2026-11-25')
    await getInsightsSeries({ table: 'invoices', dateColumn: 'invoice_date', dateKind: 'date', weeks: 1 })
    const [sql, args] = daySql()
    expect(sql).toContain("to_char(t.invoice_date, 'YYYY-MM-DD')")
    expect(sql).toContain('t.invoice_date >= $1::date AND t.invoice_date <= $2::date')
    expect(sql).not.toContain('AT TIME ZONE')
    expect(args).toEqual(['2026-11-23', '2026-11-29'])
  })

  it('stacks series as FILTERed aggregates in order and sums them into the totals', async () => {
    setup('2026-11-25', [
      { day: '2026-11-23', s0: '2', s1: '1500.5' },
      { day: '2026-11-25', s0: '1', s1: null },
    ])
    const s = await getInsightsSeries({
      table: 'orders',
      alias: 'o',
      dateColumn: 'created_at',
      joins: 'LEFT JOIN users u ON u.id = o.user_id',
      series: [
        { key: 'cod', label: 'COD', where: "o.payment_mode = 'cod'" },
        { key: 'value', label: 'Value', value: 'SUM(o.total_amount)' },
      ],
      weeks: 1,
      filter: 'cod',
    })
    const [sql] = daySql()
    expect(sql).toContain("COALESCE(COUNT(*) FILTER (WHERE o.payment_mode = 'cod'), 0) AS s0")
    expect(sql).toContain('COALESCE(SUM(o.total_amount), 0) AS s1')
    expect(sql).toContain('FROM orders o LEFT JOIN users u ON u.id = o.user_id')
    expect(s.series.map(x => x.key)).toEqual(['cod', 'value'])
    expect(s.days[0].values).toEqual([2, 1500.5])
    expect(s.days[2].values).toEqual([1, 0])
    expect(s.totals).toEqual({ total: 1503.5, busiestDay: { date: '2026-11-23', count: 1502.5 }, longestStreak: 1, currentStreak: 1 })
    expect(s.filter).toBe('cod')
  })

  it('adds a per-day top breakdown when asked, ranked and limited', async () => {
    setup(
      '2026-11-25',
      [{ day: '2026-11-24', s0: '5' }],
      [
        { day: '2026-11-24', name: 'Damaged', n: '1' },
        { day: '2026-11-24', name: 'Wrong item', n: '3' },
      ]
    )
    const s = await getInsightsSeries({ table: 'return_requests', dateColumn: 'created_at', top: { label: 't.reason', limit: 2 }, weeks: 1 })
    const topSql = String(mockQueryMany.mock.calls.find(c => String(c[0]).includes('ROW_NUMBER'))![0])
    expect(topSql).toContain("COALESCE((t.reason)::text, 'Other') AS name")
    expect(topSql).toContain('WHERE rn <= 2')
    expect(s.days[1].top).toEqual([
      { name: 'Wrong item', count: 3 },
      { name: 'Damaged', count: 1 },
    ])
    expect(s.days[0].top).toEqual([])
  })

  it('runs no top query without `top`', async () => {
    setup('2026-11-25')
    const s = await getInsightsSeries({ table: 'orders', dateColumn: 'created_at', weeks: 1 })
    expect(mockQueryMany).toHaveBeenCalledTimes(1)
    expect(s.days[0].top).toBeUndefined()
  })

  it('rejects table, alias and column names that are not plain identifiers', async () => {
    setup('2026-11-25')
    await expect(getInsightsSeries({ table: 'orders; DROP TABLE x', dateColumn: 'created_at' })).rejects.toThrow(/bad identifier/)
    await expect(getInsightsSeries({ table: 'orders', alias: 'o o', dateColumn: 'created_at' })).rejects.toThrow(/bad identifier/)
    await expect(getInsightsSeries({ table: 'orders', dateColumn: 'created_at)--' })).rejects.toThrow(/bad identifier/)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
})

const day = (date: string, ...values: number[]): InsightsDay => ({ date, values })

describe('series maths', () => {
  it('mondayGrid keeps a Sunday in the week that started six days earlier', () => {
    const g = mondayGrid('2026-11-29', 2)
    expect(g).toMatchObject({ from: '2026-11-16', to: '2026-11-29' })
    expect(g.dates).toHaveLength(14)
  })

  it('summarize finds the busiest day and streaks, the current one ending yesterday while today is zero', () => {
    const days = [day('2026-01-05', 1, 1), day('2026-01-06', 0, 3), day('2026-01-07', 0, 0), day('2026-01-08', 2, 0), day('2026-01-09', 1, 0), day('2026-01-10', 0, 0)]
    expect(summarize(days, '2026-01-10')).toEqual({ total: 8, busiestDay: { date: '2026-01-06', count: 3 }, longestStreak: 2, currentStreak: 2 })
    expect(summarize(days, '2026-01-07').currentStreak).toBe(2)
    expect(summarize(days, '2027-01-01').currentStreak).toBe(0)
    expect(summarize([day('2026-01-05', 0)], '2026-01-05')).toEqual({ total: 0, busiestDay: null, longestStreak: 0, currentStreak: 0 })
  })

  it('weeklyTotals sums each series per week and weekdayAverages skips the future', () => {
    const g = mondayGrid('2026-01-07', 2) // Wednesday of the second week
    const days = g.dates.map((date, i) => day(date, i < 7 ? 1 : 2, 1))
    expect(weeklyTotals(days)).toEqual([
      { weekStart: '2025-12-29', values: [7, 7], total: 14 },
      { weekStart: '2026-01-05', values: [14, 7], total: 21 },
    ])
    const avg = weekdayAverages(days, '2026-01-07')
    expect(avg[0]).toEqual({ day: 0, avg: 2.5 }) // both Mondays elapsed: (2 + 3) / 2
    expect(avg[3]).toEqual({ day: 3, avg: 2 }) // second Thursday is in the future
  })

  it('insightsToCsv writes one column per series, the stacked total and the top list', () => {
    const csv = insightsToCsv({
      series: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      days: [{ date: '2026-01-05', values: [1, 2], top: [{ name: 'Shoes, kids', count: 2 }] }, day('2026-01-06', 0, 0)],
    })
    expect(csv.split('\n')).toEqual(['date,a,b,total,top', '2026-01-05,1,2,3,"Shoes, kids:2"', '2026-01-06,0,0,0,'])
    expect(insightsToCsv({ series: [{ key: 'n', label: 'N' }], days: [day('2026-01-05', 4)] })).toBe('date,n\n2026-01-05,4')
  })

  it('parseInsightsQuery defaults and checks weeks and the filter', () => {
    const q = (s: string) => new URLSearchParams(s)
    expect(parseInsightsQuery(q(''))).toEqual({ ok: true, weeks: 26, filter: null })
    expect(parseInsightsQuery(q('weeks=52&filter=x'))).toEqual({ ok: true, weeks: 52, filter: null })
    expect(parseInsightsQuery(q('weeks=10'))).toEqual({ ok: false, error: 'weeks must be one of 13, 26, 52' })
    expect(parseInsightsQuery(q('weeks=13'), ['all', 'cod'])).toEqual({ ok: true, weeks: 13, filter: 'all' })
    expect(parseInsightsQuery(q('filter=cod'), ['all', 'cod'])).toEqual({ ok: true, weeks: 26, filter: 'cod' })
    expect(parseInsightsQuery(q('filter=bogus'), ['all', 'cod'])).toEqual({ ok: false, error: 'filter must be one of all, cod' })
    expect(parseInsightsQuery(q(''), undefined, [4, 8])).toEqual({ ok: true, weeks: 4, filter: null })
  })

  it('activityToInsights carries the shipped series, top categories, customer notes and server totals', () => {
    const s = activityToInsights(
      {
        weeks: 1,
        channel: 'cod',
        from: '2026-01-05',
        to: '2026-01-11',
        days: [{ date: '2026-01-05', shipped: 3, placed: 4, customers: 1, top: [{ name: 'Shirts', count: 2 }] }],
        totals: { shipped: 3, busiestDay: { date: '2026-01-05', count: 3 }, longestStreak: 1, currentStreak: 0 },
      } as never,
      '2026-01-07'
    )
    expect(s).toMatchObject({ weeks: 1, filter: 'cod', today: '2026-01-07', series: [{ key: 'shipped', label: 'Shipped' }] })
    expect(s.days[0]).toEqual({ date: '2026-01-05', values: [3], top: [{ name: 'Shirts', count: 2 }], note: '1 customer' })
    expect(s.totals).toEqual({ total: 3, busiestDay: { date: '2026-01-05', count: 3 }, longestStreak: 1, currentStreak: 0 })
    expect(s.extra?.channel).toBe('cod')
  })
})
