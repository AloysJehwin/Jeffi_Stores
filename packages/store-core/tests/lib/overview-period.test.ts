import { describe, it, expect } from 'vitest'
import { bucketFor, delta, parsePeriod, presetRange, previousPeriod, ratio, spanDays, istRangeSql } from '@/lib/overview/period'

const today = '2026-10-16'

describe('overview period', () => {
  it('builds presets in IST days', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today })
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-15', to: '2026-10-15' })
    expect(presetRange('30d', today)).toEqual({ from: '2026-09-17', to: today })
    expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('fy', '2026-02-10')).toEqual({ from: '2025-04-01', to: '2026-02-10' })
  })
  it('compares with the equal span before', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-16' })).toEqual({ from: '2026-09-15', to: '2026-09-30' })
  })
  it('falls back and clamps bad input', () => {
    expect(parsePeriod('x', today, today)).toEqual(presetRange('30d', today))
    expect(parsePeriod('2026-10-01', '2026-12-01', today)).toEqual({ from: '2026-10-01', to: today })
    expect(spanDays(parsePeriod('2020-01-01', today, today))).toBe(400)
  })
  it('picks the chart bucket and safe ratios', () => {
    expect(bucketFor({ from: '2026-10-01', to: '2026-10-16' })).toBe('day')
    expect(bucketFor(presetRange('90d', today))).toBe('week')
    expect(bucketFor(presetRange('fy', '2027-03-01'))).toBe('month')
    expect(delta(110, 100)).toBeCloseTo(0.1)
    expect(delta(5, 0)).toBeNull()
    expect(ratio(1, 0)).toBeNull()
  })
  it('renders an IST range predicate', () => {
    const r = istRangeSql('o.created_at', { from: '2026-10-01', to: '2026-10-16' }, 3)
    expect(r.sql).toContain('$3::date')
    expect(r.sql).toContain('$4::date + 1')
    expect(r.params).toEqual(['2026-10-01', '2026-10-16'])
  })
})
