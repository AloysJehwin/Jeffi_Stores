import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

import { getDashboardActivity } from '@/lib/queries/dashboard-activity'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

interface Fixture {
  today: string
  days?: Record<string, unknown>[]
  cats?: Record<string, unknown>[]
  tts?: Record<string, unknown> | null
  backlog?: number
  products?: Record<string, unknown>[]
}

// Route each query by a fragment of its SQL, so the tests don't depend on call order.
function setup(f: Fixture) {
  mockQueryOne.mockImplementation((async (sql: string) => {
    if (sql.includes('to_char((NOW()')) return { today: f.today }
    if (sql.includes('percentile_cont')) return f.tts ?? null
    if (sql.includes('NOT IN')) return { n: String(f.backlog ?? 0) }
    return null
  }) as never)
  mockQueryMany.mockImplementation((async (sql: string) => {
    if (sql.includes('WITH placed')) return f.days ?? []
    if (sql.includes('ROW_NUMBER')) return f.cats ?? []
    if (sql.includes('LATERAL')) return f.products ?? []
    return []
  }) as never)
}

const dow = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday

beforeEach(() => vi.clearAllMocks())

describe('getDashboardActivity: grid and Monday alignment', () => {
  it('builds weeks * 7 Monday-aligned days ending on this week’s Sunday', async () => {
    setup({ today: '2026-11-25' }) // a Wednesday
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.days).toHaveLength(91)
    expect(a.from).toBe('2026-08-31')
    expect(a.to).toBe('2026-11-29')
    expect(dow(a.from)).toBe(0)
    expect(dow(a.to)).toBe(6)
    expect(a.days[0].date).toBe(a.from)
    expect(a.days[90].date).toBe(a.to)
    a.days.forEach((d, i) => expect(dow(d.date)).toBe(i % 7))
  })

  it('treats a Monday as the first day of the current week', async () => {
    setup({ today: '2026-11-23' })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.thisWeek.map(d => d.date)).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
    ])
  })

  it('keeps a Sunday inside the week that started six days earlier', async () => {
    setup({ today: '2026-11-29' })
    const a = await getDashboardActivity({ weeks: 26 })
    expect(a.thisWeek[0].date).toBe('2026-11-23')
    expect(a.thisWeek[6].date).toBe('2026-11-29')
    expect(a.days).toHaveLength(182)
  })

  it('crosses month and year boundaries', async () => {
    setup({ today: '2027-01-02' }) // Saturday; Monday is 28 Dec
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.thisWeek[0].date).toBe('2026-12-28')
    expect(a.to).toBe('2027-01-03')
  })

  it('zero-fills days with no orders and maps the rows that exist', async () => {
    setup({
      today: '2026-11-25',
      days: [{ day: '2026-11-24', placed: '4', shipped: '3', customers: '2' }],
      cats: [
        { day: '2026-11-24', name: 'Fasteners', units: '5' },
        { day: '2026-11-24', name: 'Tools', units: '9' },
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    const d = a.days.find(x => x.date === '2026-11-24')!
    expect(d).toMatchObject({ placed: 4, shipped: 3, customers: 2 })
    expect(d.top).toEqual([
      { name: 'Tools', count: 9 },
      { name: 'Fasteners', count: 5 },
    ])
    expect(a.days.find(x => x.date === '2026-11-23')).toMatchObject({ placed: 0, shipped: 0, customers: 0, top: [] })
  })

  it('clamps weeks and falls back to the all channel for unknown input', async () => {
    setup({ today: '2026-11-25' })
    expect((await getDashboardActivity({ weeks: 500 })).weeks).toBe(52)
    expect((await getDashboardActivity({ weeks: 0 })).weeks).toBe(26)
    const a = await getDashboardActivity({ channel: 'wholesale' as never })
    expect(a.channel).toBe('all')
  })

  it('falls back to the local clock when the database returns no date', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.days).toHaveLength(91)
    expect(dow(a.from)).toBe(0)
  })
})

describe('getDashboardActivity: streaks, busiest day, totals', () => {
  const run = (dates: string[], today = '2026-11-25') =>
    setup({ today, days: dates.map(day => ({ day, placed: '1', shipped: '2', customers: '1' })) })

  it('counts a streak that includes today', async () => {
    run(['2026-11-23', '2026-11-24', '2026-11-25'])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.currentStreak).toBe(3)
    expect(a.totals.longestStreak).toBe(3)
  })

  it('ends the streak at yesterday while nothing has shipped yet today', async () => {
    run(['2026-11-22', '2026-11-23', '2026-11-24'])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.currentStreak).toBe(3)
  })

  it('is zero when neither today nor yesterday shipped', async () => {
    run(['2026-11-20', '2026-11-21', '2026-11-22'])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.currentStreak).toBe(0)
    expect(a.totals.longestStreak).toBe(3)
  })

  it('reports the longest streak even when it is not the current one', async () => {
    run(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-24', '2026-11-25'])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.longestStreak).toBe(4)
    expect(a.totals.currentStreak).toBe(2)
  })

  it('runs a streak across a week boundary', async () => {
    run(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'])
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.currentStreak).toBe(5)
  })

  it('totals shipped orders and picks the busiest day (earliest wins a tie)', async () => {
    setup({
      today: '2026-11-25',
      days: [
        { day: '2026-11-10', placed: '1', shipped: '5', customers: '3' },
        { day: '2026-11-12', placed: '1', shipped: '7', customers: '3' },
        { day: '2026-11-14', placed: '1', shipped: '7', customers: '3' },
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals.shipped).toBe(19)
    expect(a.totals.busiestDay).toEqual({ date: '2026-11-12', count: 7 })
  })

  it('has no busiest day and zero streaks with no shipments', async () => {
    setup({ today: '2026-11-25' })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.totals).toEqual({ shipped: 0, busiestDay: null, longestStreak: 0, currentStreak: 0 })
  })
})

describe('getDashboardActivity: weekday, this week, placed average, throughput', () => {
  it('averages shipped per weekday over elapsed days only', async () => {
    // Today is Wednesday 25 Nov. Mondays 9 Nov and 16 Nov shipped 4 and 2; 23 Nov shipped 6.
    setup({
      today: '2026-11-25',
      days: [
        { day: '2026-11-09', placed: '0', shipped: '4', customers: '1' },
        { day: '2026-11-16', placed: '0', shipped: '2', customers: '1' },
        { day: '2026-11-23', placed: '0', shipped: '6', customers: '1' },
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.weekday).toHaveLength(7)
    expect(a.weekday[0]).toEqual({ day: 0, avg: round(12 / 13) })
    // Thursday..Sunday of the current week are in the future: 12 elapsed samples, not 13.
    expect(a.weekday[3].avg).toBe(0)
  })

  it('does not count future days in the divisor', async () => {
    setup({ today: '2026-11-25', days: [{ day: '2026-11-22', placed: '0', shipped: '12', customers: '1' }] })
    const a = await getDashboardActivity({ weeks: 13 })
    // Sunday: 12 weeks of past Sundays plus none in the future (the 29th is ahead) = 12 samples.
    expect(a.weekday[6].avg).toBe(1)
  })

  it('lists Mon..Sun of the current week with placed counts', async () => {
    setup({ today: '2026-11-25', days: [{ day: '2026-11-24', placed: '9', shipped: '0', customers: '0' }] })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.thisWeek).toHaveLength(7)
    expect(a.thisWeek[1]).toEqual({ date: '2026-11-24', placed: 9 })
    expect(a.thisWeek[0].placed).toBe(0)
  })

  it('averages placed per day over the eight full weeks before this one', async () => {
    setup({
      today: '2026-11-25',
      days: [
        { day: '2026-11-22', placed: '56', shipped: '0', customers: '0' }, // last week: inside the 8
        { day: '2026-09-27', placed: '999', shipped: '0', customers: '0' }, // nine weeks back: outside
        { day: '2026-11-24', placed: '999', shipped: '0', customers: '0' }, // this week: outside
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.placedAvg8w).toBe(1) // 56 / (8 * 7)
  })

  it('uses fewer weeks for the average when fewer exist', async () => {
    setup({ today: '2026-11-25', days: [{ day: '2026-11-22', placed: '7', shipped: '0', customers: '0' }] })
    const a = await getDashboardActivity({ weeks: 1 })
    expect(a.placedAvg8w).toBe(0)
    expect(a.days).toHaveLength(7)
  })

  it('sums placed and shipped per week, oldest first', async () => {
    setup({
      today: '2026-11-25',
      days: [
        { day: '2026-11-16', placed: '3', shipped: '1', customers: '1' },
        { day: '2026-11-22', placed: '2', shipped: '4', customers: '1' },
        { day: '2026-11-23', placed: '5', shipped: '6', customers: '1' },
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.throughput).toHaveLength(13)
    expect(a.throughput[0].weekStart).toBe('2026-08-31')
    expect(a.throughput[11]).toEqual({ weekStart: '2026-11-16', placed: 5, shipped: 5 })
    expect(a.throughput[12]).toEqual({ weekStart: '2026-11-23', placed: 5, shipped: 6 })
  })
})

describe('getDashboardActivity: time to ship', () => {
  it('returns the five buckets in order with their counts', async () => {
    setup({ today: '2026-11-25', tts: { b0: '10', b1: '5', b2: '3', b3: '1', b4: '1', median: '0.8' } })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.timeToShip).toEqual([
      { bucket: '<1d', count: 10 },
      { bucket: '1-2d', count: 5 },
      { bucket: '2-4d', count: 3 },
      { bucket: '4-7d', count: 1 },
      { bucket: '7d+', count: 1 },
    ])
    expect(a.shippedWithin2dPct).toBe(75) // (10 + 5) / 20
    expect(a.medianDaysToShip).toBe(0.8)
  })

  it('rounds the median to two places and the percentage to one', async () => {
    setup({ today: '2026-11-25', tts: { b0: '1', b1: '1', b2: '1', b3: '0', b4: '0', median: '1.23456' } })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.medianDaysToShip).toBe(1.23)
    expect(a.shippedWithin2dPct).toBe(66.7)
  })

  it('keeps a median of exactly zero distinct from no data', async () => {
    setup({ today: '2026-11-25', tts: { b0: '3', b1: '0', b2: '0', b3: '0', b4: '0', median: '0' } })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.medianDaysToShip).toBe(0)
    expect(a.shippedWithin2dPct).toBe(100)
  })

  it('counts boundary days into the upper bucket as the SQL does (1d is 1-2d)', async () => {
    setup({ today: '2026-11-25', tts: { b0: '0', b1: '4', b2: '0', b3: '0', b4: '0', median: '1' } })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.timeToShip[1]).toEqual({ bucket: '1-2d', count: 4 })
    expect(a.shippedWithin2dPct).toBe(100)
  })

  it('is null with nothing shipped', async () => {
    setup({ today: '2026-11-25', tts: { b0: '0', b1: '0', b2: '0', b3: '0', b4: '0', median: null } })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.medianDaysToShip).toBeNull()
    expect(a.shippedWithin2dPct).toBeNull()
    expect(a.timeToShip.every(b => b.count === 0)).toBe(true)
  })

  it('asks the database for the median (even counts interpolate in percentile_cont)', async () => {
    setup({ today: '2026-11-25' })
    await getDashboardActivity({ weeks: 13 })
    const sql = mockQueryOne.mock.calls.map(c => String(c[0])).find(s => s.includes('percentile_cont'))!
    expect(sql).toContain('percentile_cont(0.5)')
    expect(sql).toContain('d >= 1 AND d < 2')
    expect(sql).toContain('d >= 7')
  })
})

describe('getDashboardActivity: backlog and top products', () => {
  it('reports the backlog count', async () => {
    setup({ today: '2026-11-25', backlog: 17 })
    expect((await getDashboardActivity({ weeks: 13 })).backlog).toBe(17)
  })

  it('maps products with on-time %, average days and eight weekly counts oldest first', async () => {
    setup({
      today: '2026-11-25',
      products: [
        {
          id: 'p1', name: 'Bolt M8', shipped: '40', orders: '8', on_time: '6', avg_days: '1.456',
          w0: '10', w1: '9', w2: '8', w3: '7', w4: '6', w5: '0', w6: null, w7: '1',
        },
        { id: 'p2', name: 'Nut', shipped: '2.5', orders: '0', on_time: '0', avg_days: null },
      ],
    })
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.topProducts[0]).toEqual({
      id: 'p1', name: 'Bolt M8', shipped: 40, onTimePct: 75, avgDays: 1.46,
      weekly: [1, 0, 0, 6, 7, 8, 9, 10],
    })
    expect(a.topProducts[1]).toMatchObject({ shipped: 2.5, onTimePct: null, avgDays: null })
    expect(a.topProducts[1].weekly).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('getDashboardActivity: empty data and SQL shape', () => {
  it('returns a complete empty structure', async () => {
    setup({ today: '2026-11-25' })
    const a = await getDashboardActivity({ weeks: 13, channel: 'cod' })
    expect(a.channel).toBe('cod')
    expect(a.days.every(d => d.shipped === 0 && d.placed === 0 && d.customers === 0 && d.top.length === 0)).toBe(true)
    expect(a.weekday.every(w => w.avg === 0)).toBe(true)
    expect(a.placedAvg8w).toBe(0)
    expect(a.topProducts).toEqual([])
    expect(a.backlog).toBe(0)
    expect(a.throughput.every(w => w.placed === 0 && w.shipped === 0)).toBe(true)
  })

  it('tolerates null results from the database layer', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue(undefined as never)
    const a = await getDashboardActivity({ weeks: 13 })
    expect(a.days).toHaveLength(91)
    expect(a.topProducts).toEqual([])
  })

  it('binds the date range as parameters and filters by channel in SQL', async () => {
    setup({ today: '2026-11-25' })
    await getDashboardActivity({ weeks: 13, channel: 'business' })
    const withParams = mockQueryMany.mock.calls.find(c => String(c[0]).includes('WITH placed'))!
    expect(withParams[1]).toEqual(['2026-08-31', '2026-11-29'])
    expect(String(withParams[0])).toContain('buyer_gstin')
    expect(String(withParams[0])).toContain("Asia/Kolkata")
    const products = mockQueryMany.mock.calls.find(c => String(c[0]).includes('LATERAL'))!
    expect(products[1]).toEqual(['2026-08-31', '2026-11-29', '2026-11-23'])
  })

  it.each([
    ['online', 'NOT ('],
    ['cod', "ILIKE '%cod%'"],
    ['all', 'TRUE'],
  ] as const)('the %s channel predicate reaches the query', async (channel, fragment) => {
    setup({ today: '2026-11-25' })
    await getDashboardActivity({ weeks: 13, channel })
    const sql = String(mockQueryMany.mock.calls.find(c => String(c[0]).includes('WITH placed'))![0])
    expect(sql).toContain(fragment)
  })
})

function round(v: number) {
  return Math.round(v * 100) / 100
}
