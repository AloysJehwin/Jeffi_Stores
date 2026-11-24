import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) }))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 500 }) }))

import { prorationPaise } from '@controller/lib/billing/lines'
import { DAY, NOW } from './fixtures'

const cycle = { cycleStart: NOW - 15 * DAY, cycleEnd: NOW + 15 * DAY }

describe('prorationPaise', () => {
  it('charges the monthly difference for what is left of the cycle', () => {
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'monthly', from: NOW, ...cycle })).toBe(10000)
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'monthly', from: NOW + 10 * DAY, ...cycle })).toBe(Math.round((20000 * 5) / 30))
  })

  it('prorates a yearly cycle at ten months', () => {
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'yearly', from: NOW, ...cycle })).toBe(100000)
  })

  it('is never negative: a decrease waits for cycle end with no refund', () => {
    expect(prorationPaise({ monthlyDeltaPaise: -20000, interval: 'monthly', from: NOW, ...cycle })).toBe(0)
    expect(prorationPaise({ monthlyDeltaPaise: 0, interval: 'monthly', from: NOW, ...cycle })).toBe(0)
  })

  it('is zero once the cycle has ended or when it is unknown', () => {
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'monthly', from: NOW + 20 * DAY, ...cycle })).toBe(0)
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'monthly', from: NOW, cycleStart: NOW, cycleEnd: NOW })).toBe(0)
  })

  it('never charges more than a full cycle', () => {
    expect(prorationPaise({ monthlyDeltaPaise: 20000, interval: 'monthly', from: NOW - 30 * DAY, ...cycle })).toBe(20000)
  })
})
