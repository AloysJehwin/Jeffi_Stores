import { describe, it, expect } from 'vitest'
import { rs, rsCompact, numStr, pctStr, hoursStr, daysStr, delta } from '@/components/admin/kit/format'

// Plain formatters (en-IN). Pure functions — no DOM, just the exact strings the dashboard shows.

describe('rs / rsCompact / numStr', () => {
  it('rounds and groups rupees in Indian digits', () => {
    expect(rs(1234567)).toBe('Rs 12,34,567')
    expect(rs(99.6)).toBe('Rs 100')
  })

  it('rsCompact uses Cr above 1e7 and L above 1e5', () => {
    expect(rsCompact(25000000)).toBe('Rs 2.50 Cr')
    expect(rsCompact(250000)).toBe('Rs 2.50 L')
    expect(rsCompact(5000)).toBe('Rs 5,000')
  })

  it('numStr groups a plain number', () => {
    expect(numStr(1234567)).toBe('12,34,567')
  })
})

describe('pctStr / hoursStr / daysStr', () => {
  it('pctStr renders n/a for null and a fixed-digit percent otherwise', () => {
    expect(pctStr(null)).toBe('n/a')
    expect(pctStr(12.345)).toBe('12.3%')
    expect(pctStr(12.345, 2)).toBe('12.35%')
  })

  it('hoursStr switches minutes / hours / days by magnitude', () => {
    expect(hoursStr(null)).toBe('n/a')
    expect(hoursStr(0.5)).toBe('30 min')
    expect(hoursStr(5)).toBe('5.0 h')
    expect(hoursStr(72)).toBe('3.0 d')
  })

  it('daysStr switches hours / days by magnitude', () => {
    expect(daysStr(null)).toBe('n/a')
    expect(daysStr(0.5)).toBe('12 h')
    expect(daysStr(3)).toBe('3.0 d')
  })
})

describe('delta', () => {
  it('returns null when either value is null or prev is zero', () => {
    expect(delta(null, 10)).toBeNull()
    expect(delta(10, null)).toBeNull()
    expect(delta(10, 0)).toBeNull()
  })

  it('returns the whole-percent change', () => {
    expect(delta(150, 100)).toBe(50)
    expect(delta(80, 100)).toBe(-20)
  })
})
