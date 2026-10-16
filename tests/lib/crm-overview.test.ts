import { describe, it, expect } from 'vitest'
import {
  addDays,
  bucketFor,
  insightsRangeFor,
  isValidIso,
  istToday,
  matchPreset,
  parsePeriod,
  presetPeriod,
  previousPeriod,
  spanDays,
} from '@/app/(admin)/admin/crm/_lib/period'
import { buildAttention, buildCohorts, toKpis, toTopCustomers, toTrend } from '@/app/(admin)/admin/crm/_lib/overview'

describe('crm overview period helpers', () => {
  const today = '2026-10-16'

  it('computes presets', () => {
    expect(presetPeriod('7d', today)).toEqual({ from: '2026-10-10', to: today })
    expect(presetPeriod('30d', today)).toEqual({ from: '2026-09-17', to: today })
    expect(presetPeriod('90d', today)).toEqual({ from: '2026-07-19', to: today })
    expect(presetPeriod('this_month', today)).toEqual({ from: '2026-10-01', to: today })
    expect(presetPeriod('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetPeriod('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetPeriod('fy', today)).toEqual({ from: '2026-04-01', to: today })
    expect(presetPeriod('fy', '2026-02-10')).toEqual({ from: '2025-04-01', to: '2026-02-10' })
  })

  it('matches presets and maps insight ranges', () => {
    expect(matchPreset(presetPeriod('90d', today), today)).toBe('90d')
    expect(matchPreset({ from: '2026-01-01', to: '2026-01-02' }, today)).toBeNull()
    expect(insightsRangeFor('this_month')).toBe('month')
    expect(insightsRangeFor('fy')).toBeNull()
    expect(insightsRangeFor(null)).toBeNull()
  })

  it('builds the previous equal-length window', () => {
    expect(previousPeriod({ from: '2026-09-17', to: '2026-10-16' })).toEqual({ from: '2026-08-18', to: '2026-09-16' })
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-01' })).toEqual({ from: '2026-02-28', to: '2026-02-28' })
    expect(spanDays({ from: '2026-09-17', to: '2026-10-16' })).toBe(30)
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('validates and parses periods', () => {
    expect(isValidIso('2026-02-30')).toBe(false)
    expect(isValidIso('2026-02-28')).toBe(true)
    expect(parsePeriod('2026-10-01', '2026-10-05', today)).toEqual({ from: '2026-10-01', to: '2026-10-05' })
    expect(parsePeriod('2026-10-05', '2026-10-01', today)).toEqual(presetPeriod('30d', today))
    expect(parsePeriod('bad', null, today)).toEqual(presetPeriod('30d', today))
    expect(parsePeriod('2020-01-01', '2026-10-01', today)).toEqual(presetPeriod('30d', today))
  })

  it('picks a chart bucket by span', () => {
    expect(bucketFor(presetPeriod('30d', today))).toBe('day')
    expect(bucketFor(presetPeriod('90d', today))).toBe('week')
    expect(bucketFor({ from: '2025-04-01', to: today })).toBe('month')
  })

  it('reads today in IST', () => {
    expect(istToday(new Date('2026-10-15T19:00:00Z'))).toBe('2026-10-16')
  })
})

describe('crm overview builders', () => {
  it('derives ratio KPIs and guards zero divisors', () => {
    const k = toKpis({ active_customers: 4, repeat_customers: 1, orders: 5, revenue: '1000', buyers_to_date: 10, lifetime_revenue: 50000 })
    expect(k.repeatRate).toBe(0.25)
    expect(k.aov).toBe(200)
    expect(k.revenuePerCustomer).toBe(250)
    expect(k.avgClv).toBe(5000)
    const z = toKpis(null)
    expect(z.aov).toBeNull()
    expect(z.repeatRate).toBeNull()
    expect(z.totalCustomers).toBe(0)
  })

  it('maps trend rows', () => {
    expect(toTrend([{ label: '2026-10-01', new_revenue: '10', returning_revenue: 5, new_buyers: 1, returning_buyers: '2' }])).toEqual([
      { label: '2026-10-01', newRevenue: 10, returningRevenue: 5, newBuyers: 1, returningBuyers: 2 },
    ])
  })

  it('builds cohort retention with future months left empty', () => {
    const rows = [
      { cohort: '2026-07', size: 4, k: 1, active: 2 },
      { cohort: '2026-07', size: 4, k: 3, active: 1 },
      { cohort: '2026-09', size: 2, k: null, active: null },
    ]
    const out = buildCohorts(rows, '2026-10')
    expect(out[0]).toEqual({ cohort: '2026-07', size: 4, retention: [0.5, 0, 0.25, null, null, null] })
    expect(out[1]).toEqual({ cohort: '2026-09', size: 2, retention: [0, null, null, null, null, null] })
  })

  it('names top customers', () => {
    const [c] = toTopCustomers([{ id: 'u1', first_name: null, last_name: null, email: 'a@b.c', orders: 2, revenue: '300', ltv: 900, health_score: null }])
    expect(c.name).toBe('a@b.c')
    expect(c.revenue).toBe(300)
    expect(c.healthScore).toBeNull()
  })

  it('lists attention items by severity with links', () => {
    const cur = toKpis({ active_customers: 5, repeat_customers: 1, orders: 5, revenue: 100 })
    const prev = toKpis({ active_customers: 10, repeat_customers: 5, orders: 10, revenue: 200 })
    const items = buildAttention(
      { highValueQuiet: 2, highValueQuietLtv: 60000, noSecondOrder: 3, criticalNoTask: 0, newLeads: 1 },
      cur,
      prev
    )
    expect(items.map(i => i.key)).toEqual(['high_value_quiet', 'no_second_order', 'active_drop', 'repeat_drop', 'new_leads'])
    expect(items[0].href).toBe('/admin/customers?segment=at_risk')
    expect(items[2].label).toContain('50%')
    expect(buildAttention({ highValueQuiet: 0, highValueQuietLtv: 0, noSecondOrder: 0, criticalNoTask: 0, newLeads: 0 }, cur, cur)).toEqual([])
  })
})
