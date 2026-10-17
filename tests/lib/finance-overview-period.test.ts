import { describe, it, expect } from 'vitest'
import {
  addDays,
  agingBucket,
  bucketFor,
  bucketStart,
  bucketStarts,
  changeOf,
  fillSeries,
  isValidRange,
  matchPreset,
  presetRange,
  previousPeriod,
  spanDays,
} from '@/app/(admin)/admin/financial/_components/overview-period'

// 2026-10-16 10:00 IST
const NOW = new Date('2026-10-16T04:30:00Z')

describe('finance overview period helpers', () => {
  it('builds presets on IST days', () => {
    expect(presetRange('7d', NOW)).toEqual({ from: '2026-10-10', to: '2026-10-16' })
    expect(presetRange('30d', NOW)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
    expect(presetRange('90d', NOW)).toEqual({ from: '2026-07-19', to: '2026-10-16' })
    expect(presetRange('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-16' })
    expect(presetRange('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('fy', NOW)).toEqual({ from: '2026-04-01', to: '2026-10-16' })
    expect(presetRange('fy', new Date('2027-02-10T00:00:00Z'))).toEqual({ from: '2026-04-01', to: '2027-02-10' })
    expect(presetRange('last_month', new Date('2026-01-05T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('rolls into the next IST day before UTC does', () => {
    expect(presetRange('7d', new Date('2026-10-16T20:00:00Z')).to).toBe('2026-10-17')
  })

  it('matches a range back to its preset', () => {
    expect(matchPreset(presetRange('90d', NOW), NOW)).toBe('90d')
    expect(matchPreset({ from: '2026-01-01', to: '2026-01-02' }, NOW)).toBeNull()
  })

  it('gives the equal-length previous period', () => {
    expect(previousPeriod({ from: '2026-09-17', to: '2026-10-16' })).toEqual({ from: '2026-08-18', to: '2026-09-16' })
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-01' })).toEqual({ from: '2026-02-28', to: '2026-02-28' })
    expect(spanDays({ from: '2024-02-01', to: '2024-02-29' })).toBe(29)
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01')
  })

  it('validates ranges', () => {
    expect(isValidRange({ from: '2026-01-01', to: '2026-01-31' })).toBe(true)
    expect(isValidRange({ from: '2026-02-01', to: '2026-01-31' })).toBe(false)
    expect(isValidRange({ from: '2026-02-30', to: '2026-03-01' })).toBe(false)
    expect(isValidRange({ from: '2026-1-1', to: '2026-03-01' })).toBe(false)
    expect(isValidRange({ from: '2024-01-01', to: '2026-01-01' })).toBe(false)
    expect(isValidRange({ from: '2026-01-01' })).toBe(false)
  })

  it('picks a bucket size and aligns weeks to Monday', () => {
    expect(bucketFor({ from: '2026-09-17', to: '2026-10-16' })).toBe('day')
    expect(bucketFor({ from: '2026-07-19', to: '2026-10-16' })).toBe('week')
    expect(bucketFor({ from: '2026-04-01', to: '2027-03-31' })).toBe('month')
    expect(bucketStart('2026-10-16', 'week')).toBe('2026-10-12')
    expect(bucketStart('2026-10-12', 'week')).toBe('2026-10-12')
    expect(bucketStart('2026-10-18', 'week')).toBe('2026-10-12')
    expect(bucketStart('2026-10-16', 'month')).toBe('2026-10-01')
    expect(bucketStarts({ from: '2026-11-15', to: '2027-01-02' }, 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
  })

  it('zero-fills series and merges rows into their bucket', () => {
    const s = fillSeries({ from: '2026-10-14', to: '2026-10-16' }, 'day', ['a', 'b'] as const, [
      { b: '2026-10-15', k: 'a', v: '10.5' },
      { b: '2026-10-15', k: 'b', v: 2 },
      { b: '2026-10-20', k: 'a', v: 99 },
      { b: '2026-10-14', k: 'zzz', v: 1 },
    ])
    expect(s).toEqual([
      { label: '2026-10-14', a: 0, b: 0 },
      { label: '2026-10-15', a: 10.5, b: 2 },
      { label: '2026-10-16', a: 0, b: 0 },
    ])
  })

  it('buckets aging and computes change', () => {
    expect([-3, 0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      'current',
      'current',
      'd1_30',
      'd1_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd90_plus',
    ])
    expect(changeOf(150, 100)).toBe(0.5)
    expect(changeOf(-50, -100)).toBe(0.5)
    expect(changeOf(10, 0)).toBeNull()
  })
})
