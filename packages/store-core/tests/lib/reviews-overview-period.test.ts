import { describe, it, expect } from 'vitest'
import {
  addDays,
  isDate,
  istToday,
  matchPreset,
  parsePeriod,
  presetRange,
  previousPeriod,
  runningAverage,
  spanDays,
  MAX_SPAN_DAYS,
} from '@/lib/reviews/overview-period'

const TODAY = '2026-10-16'

describe('presetRange', () => {
  it('builds rolling day windows ending today', () => {
    expect(presetRange('7d', TODAY)).toEqual({ from: '2026-10-10', to: TODAY })
    expect(presetRange('30d', TODAY)).toEqual({ from: '2026-09-17', to: TODAY })
    expect(spanDays(presetRange('90d', TODAY))).toBe(90)
  })
  it('handles calendar months, including January', () => {
    expect(presetRange('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(presetRange('last_month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('last_month', '2024-03-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
  it('starts the financial year on 1 April', () => {
    expect(presetRange('fy', TODAY)).toEqual({ from: '2026-04-01', to: TODAY })
    expect(presetRange('fy', '2027-02-10')).toEqual({ from: '2026-04-01', to: '2027-02-10' })
    expect(presetRange('fy', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-04-01' })
  })
})

describe('previousPeriod', () => {
  it('is the equal-length window right before', () => {
    expect(previousPeriod({ from: '2026-09-17', to: TODAY })).toEqual({ from: '2026-08-18', to: '2026-09-16' })
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-01-29', to: '2026-02-28' })
  })
})

describe('parsePeriod', () => {
  it('defaults to 30 days on bad input', () => {
    const d = presetRange('30d', TODAY)
    expect(parsePeriod(null, null, TODAY)).toEqual(d)
    expect(parsePeriod('2026-13-01', TODAY, TODAY)).toEqual(d)
    expect(parsePeriod('2026-10-10', '2026-10-01', TODAY)).toEqual(d)
    expect(parsePeriod('2026-02-30', '2026-03-01', TODAY)).toEqual(d)
  })
  it('clamps the end to today and the span to the maximum', () => {
    expect(parsePeriod('2026-10-01', '2026-12-31', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    const long = parsePeriod('2020-01-01', TODAY, TODAY)
    expect(long.to).toBe(TODAY)
    expect(spanDays(long)).toBe(MAX_SPAN_DAYS)
  })
  it('keeps a valid range', () => {
    expect(parsePeriod('2026-05-01', '2026-05-31', TODAY)).toEqual({ from: '2026-05-01', to: '2026-05-31' })
  })
})

describe('helpers', () => {
  it('matches presets', () => {
    expect(matchPreset(presetRange('fy', TODAY), TODAY)).toBe('fy')
    expect(matchPreset({ from: '2026-05-01', to: '2026-05-02' }, TODAY)).toBeNull()
  })
  it('validates and shifts dates', () => {
    expect(isDate('2026-10-16')).toBe(true)
    expect(isDate('2026-1-6')).toBe(false)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('gives the IST date', () => {
    expect(istToday(new Date('2026-10-15T19:00:00Z'))).toBe('2026-10-16')
  })
  it('computes a weighted running average and back-fills leading gaps', () => {
    expect(
      runningAverage([
        { reviews: 0, avgRating: null },
        { reviews: 2, avgRating: 5 },
        { reviews: 0, avgRating: null },
        { reviews: 2, avgRating: 2 },
      ])
    ).toEqual([5, 5, 5, 3.5])
    expect(runningAverage([{ reviews: 0, avgRating: null }])).toEqual([null])
  })
})
