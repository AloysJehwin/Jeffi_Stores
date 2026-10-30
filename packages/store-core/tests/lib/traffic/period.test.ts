import { describe, it, expect } from 'vitest'
import { bucketKeys, fillSeries, istBounds, trafficPeriod, trendBucket, weekStart } from '@/lib/traffic/period'
import { previousPeriod } from '@/lib/overview/period'

// 2026-10-16 10:00 IST
const NOW = new Date('2026-10-16T04:30:00Z')

describe('traffic period helpers', () => {
  it('defaults to the last 30 IST days and keeps a valid range', () => {
    expect(trafficPeriod(null, null, NOW)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
    expect(trafficPeriod('2026-09-01', '2026-09-30', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(trafficPeriod('2026-10-01', '2026-12-31', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-16' })
    expect(trafficPeriod('bad', '2026-09-30', NOW)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })

  it('uses the IST day, not UTC, near midnight', () => {
    expect(trafficPeriod(null, null, new Date('2026-10-16T20:00:00Z')).to).toBe('2026-10-17')
  })

  it('compares with the previous equal-length period', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-16' })).toEqual({ from: '2026-09-15', to: '2026-09-30' })
  })

  it('switches to weekly buckets beyond 60 days', () => {
    expect(trendBucket({ from: '2026-08-18', to: '2026-10-16' })).toBe('day')
    expect(trendBucket({ from: '2026-08-17', to: '2026-10-16' })).toBe('week')
  })

  it('bounds the period on IST midnights', () => {
    expect(istBounds({ from: '2026-10-01', to: '2026-10-16' })).toEqual(['2026-10-01T00:00:00+05:30', '2026-10-17T00:00:00+05:30'])
  })

  it('lists day and Monday-week bucket keys', () => {
    expect(bucketKeys({ from: '2026-10-14', to: '2026-10-16' }, 'day')).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    expect(weekStart('2026-10-16')).toBe('2026-10-12')
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
    expect(weekStart('2026-10-18')).toBe('2026-10-12')
    expect(bucketKeys({ from: '2026-10-01', to: '2026-10-16' }, 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
  })

  it('fills missing buckets with blanks', () => {
    const out = fillSeries(['a', 'b', 'c'], [{ bucket: 'b', n: 2 }], k => ({ bucket: k, n: 0 }))
    expect(out).toEqual([
      { bucket: 'a', n: 0 },
      { bucket: 'b', n: 2 },
      { bucket: 'c', n: 0 },
    ])
  })
})
