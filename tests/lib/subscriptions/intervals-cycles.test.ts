import { describe, it, expect } from 'vitest'
import { billingCyclesLabel, cycleLimitsError, normalizeCycleCount } from '@/lib/subscriptions/intervals'

describe('billing cycle helpers', () => {
  it('normalizes the admin cycle count to 1..520 or null', () => {
    expect(normalizeCycleCount('')).toBeNull()
    expect(normalizeCycleCount(null)).toBeNull()
    expect(normalizeCycleCount('0')).toBeNull()
    expect(normalizeCycleCount('2.5')).toBeNull()
    expect(normalizeCycleCount('521')).toBeNull()
    expect(normalizeCycleCount('12')).toBe(12)
    expect(normalizeCycleCount(520)).toBe(520)
  })

  it('rejects a minimum above the number of cycles', () => {
    expect(cycleLimitsError(3, 6)).toMatch(/cannot exceed/)
    expect(cycleLimitsError(6, 6)).toBeNull()
    expect(cycleLimitsError(null, 6)).toBeNull()
    expect(cycleLimitsError(6, null)).toBeNull()
  })

  it('labels the term', () => {
    expect(billingCyclesLabel(null, false)).toBe('Until you cancel')
    expect(billingCyclesLabel(12, false)).toBe('12 deliveries, then it ends')
    expect(billingCyclesLabel(12, true)).toBe('12 charges, then it ends')
    expect(billingCyclesLabel(1, true)).toBe('1 charge, then it ends')
  })
})
