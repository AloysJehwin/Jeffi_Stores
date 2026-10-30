import { describe, it, expect } from 'vitest'
import {
  buildReorder,
  reorderAdvice,
  resolvePeriod,
  turnoverStats,
  MAX_RANGE_DAYS,
} from '@admin/app/api/(admin)/admin/inventory/overview/compute'
import {
  formatRange,
  matchPreset,
  presetRange,
  rangeFromParams,
} from '@admin/app/(admin)/admin/inventory/_components/inventoryOverviewPeriod'

describe('resolvePeriod', () => {
  it('defaults to the last 30 IST days with an equal previous window', () => {
    expect(resolvePeriod(null, null, '2026-10-16')).toEqual({
      from: '2026-09-17',
      to: '2026-10-16',
      prevFrom: '2026-08-18',
      prevTo: '2026-09-16',
      days: 30,
    })
  })

  it('swaps reversed dates and rejects malformed ones', () => {
    expect(resolvePeriod('2026-10-10', '2026-10-01', '2026-10-16')).toMatchObject({ from: '2026-10-01', to: '2026-10-10', days: 10, prevTo: '2026-09-30', prevFrom: '2026-09-21' })
    expect(resolvePeriod('bad', '2026-10-01', '2026-10-16').days).toBe(30)
  })

  it('clamps long ranges', () => {
    const p = resolvePeriod('2020-01-01', '2026-10-16', '2026-10-16')
    expect(p.days).toBe(MAX_RANGE_DAYS)
    expect(p.to).toBe('2026-10-16')
  })
})

describe('reorderAdvice', () => {
  it('ignores SKUs without sales or with enough cover', () => {
    expect(reorderAdvice({ qty: 10, sold: 0 }, 30)).toBeNull()
    expect(reorderAdvice({ qty: 100, sold: 30 }, 30)).toBeNull() // 100 days of cover
  })

  it('flags cover below 14 days and suggests threshold + 30 days of stock', () => {
    const a = reorderAdvice({ qty: 5, sold: 30 }, 30)!
    expect(a.daysOfCover).toBe(5)
    expect(a.thresholdDays).toBe(14)
    expect(a.suggestedQty).toBe(39) // 1/day * 44 days - 5
  })

  it('uses a longer lead time as the threshold and rounds up to the MOQ in base units', () => {
    const a = reorderAdvice({ qty: 18, sold: 30, lead_time_days: 21, moq: 10, purchase_unit_factor: 12 }, 30)!
    expect(a.thresholdDays).toBe(21)
    expect(a.leadTimeDays).toBe(21)
    expect(a.suggestedQty).toBe(120)
  })

  it('treats negative stock as zero on hand', () => {
    expect(reorderAdvice({ qty: -4, sold: 60 }, 30)!.suggestedQty).toBe(88)
  })

  it('sorts by least cover first', () => {
    const rows = [
      { id: 'a', qty: 10, sold: 30 },
      { id: 'b', qty: 1, sold: 30 },
      { id: 'c', qty: 500, sold: 30 },
    ]
    expect(buildReorder(rows, 30).map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('turnoverStats', () => {
  it('computes period and annual turnover and days of cover', () => {
    const t = turnoverStats(1000, 5000, 30)
    expect(t.turnover).toBeCloseTo(0.2)
    expect(t.annualTurnover).toBeCloseTo(0.2 * 365 / 30)
    expect(t.daysOfCover).toBeCloseTo(150)
  })

  it('returns nulls without stock or sales', () => {
    expect(turnoverStats(100, 0, 30).turnover).toBeNull()
    expect(turnoverStats(0, 100, 30).daysOfCover).toBeNull()
  })
})

describe('overview period presets', () => {
  const today = '2026-10-16'
  it('builds each preset', () => {
    expect(presetRange('7d', today)).toEqual({ from: '2026-10-10', to: today })
    expect(presetRange('30d', today)).toEqual({ from: '2026-09-17', to: today })
    expect(presetRange('90d', today)).toEqual({ from: '2026-07-19', to: today })
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: today })
    expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('fy', today)).toEqual({ from: '2026-04-01', to: today })
  })

  it('starts the financial year in the previous April before April', () => {
    expect(presetRange('fy', '2027-02-10')).toEqual({ from: '2026-04-01', to: '2027-02-10' })
    expect(presetRange('last_month', '2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('reads params with a 30-day fallback and matches presets', () => {
    expect(rangeFromParams(null, null, today)).toEqual(presetRange('30d', today))
    expect(rangeFromParams('2026-10-05', '2026-10-01', today)).toEqual({ from: '2026-10-01', to: '2026-10-05' })
    expect(matchPreset(presetRange('fy', today), today)).toBe('fy')
    expect(matchPreset({ from: '2026-10-02', to: '2026-10-03' }, today)).toBeNull()
    expect(formatRange({ from: '2026-10-01', to: '2026-10-01' })).toBe('1 Oct 2026')
  })
})
