import { describe, it, expect } from 'vitest'
import { computeEdd, transitDays } from '@/lib/edd'

function daysFromToday(edd: string): number {
  const d = new Date(edd + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

describe('transitDays', () => {
  it('own region (49…) → 7', () => expect(transitDays('490001')).toBe(7))
  it('metro (Chennai 600) → 10', () => expect(transitDays('600001')).toBe(10))
  it('rest of India → 14', () => expect(transitDays('831001')).toBe(14))
  it('missing / non-6-digit pin → 7', () => {
    expect(transitDays('')).toBe(7)
    expect(transitDays('12')).toBe(7)
  })
  it('metro SUBURB prefixes the short 7-item list missed → 10 (not 14)', () => {
    // 411 (Pune), 401 (Mumbai suburb), 711 (Kolkata) are in the full set only.
    expect(transitDays('411001')).toBe(10)
    expect(transitDays('401101')).toBe(10)
    expect(transitDays('711101')).toBe(10)
  })
})

describe('computeEdd', () => {
  it('metro: handling(2) + transit(10) + extra(0) = 12 days', () => {
    expect(daysFromToday(computeEdd({ pin: '600001' }))).toBe(12)
  })
  it('own region: 2 + 7 = 9 days', () => {
    expect(daysFromToday(computeEdd({ pin: '490001' }))).toBe(9)
  })
  it('rest of India: 2 + 14 = 16 days', () => {
    expect(daysFromToday(computeEdd({ pin: '831001' }))).toBe(16)
  })
  it('floors handling at 2 (handlingDays=0 → still +2)', () => {
    expect(computeEdd({ pin: '600001', handlingDays: 0 })).toBe(computeEdd({ pin: '600001', handlingDays: 2 }))
  })
  it('adds extraDays and larger handling', () => {
    // 3 handling + 10 metro + 4 extra = 17
    expect(daysFromToday(computeEdd({ pin: '600001', handlingDays: 3, extraDays: 4 }))).toBe(17)
  })
  it('returns a YYYY-MM-DD string', () => {
    expect(computeEdd({ pin: '600001' })).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
