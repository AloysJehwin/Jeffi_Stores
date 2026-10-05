import { describe, it, expect } from 'vitest'
import {
  BASE_TIER,
  multiplierFor,
  nextTierAfter,
  tierForPoints,
  tierName,
  tierRank,
  type LoyaltyTier,
} from '@/lib/loyalty/tiers'

const tiers: LoyaltyTier[] = [
  BASE_TIER,
  { key: 'silver', name: 'Silver', minPoints: 100, multiplier: 1.25 },
  { key: 'gold', name: 'Gold', minPoints: 500, multiplier: 1.5 },
  { key: 'platinum', name: 'Platinum', minPoints: 1500, multiplier: 2 },
]

describe('loyalty tiers', () => {
  it('ranks the four tiers in order and treats anything unknown as Bronze', () => {
    expect(['bronze', 'silver', 'gold', 'platinum'].map(tierRank)).toEqual([0, 1, 2, 3])
    expect(tierRank('diamond')).toBe(0)
    expect(tierRank(null)).toBe(0)
  })

  it('gives the display name for a stored key', () => {
    expect(tierName('silver')).toBe('Silver')
    expect(tierName('platinum')).toBe('Platinum')
    expect(tierName(undefined)).toBe('Bronze')
  })

  it('picks the highest tier whose threshold is reached', () => {
    expect(tierForPoints(0, tiers).key).toBe('bronze')
    expect(tierForPoints(99, tiers).key).toBe('bronze')
    expect(tierForPoints(100, tiers).key).toBe('silver')
    expect(tierForPoints(499, tiers).key).toBe('silver')
    expect(tierForPoints(500, tiers).key).toBe('gold')
    expect(tierForPoints(1500, tiers).key).toBe('platinum')
    expect(tierForPoints(99999, tiers).key).toBe('platinum')
  })

  it('treats a negative lifetime balance as zero', () => {
    expect(tierForPoints(-40, tiers).key).toBe('bronze')
  })

  it('names the next tier, and none above the top', () => {
    expect(nextTierAfter('bronze', tiers)?.key).toBe('silver')
    expect(nextTierAfter('gold', tiers)?.key).toBe('platinum')
    expect(nextTierAfter('platinum', tiers)).toBeNull()
  })

  it('returns the earning rate of a tier and 1x when it is unknown', () => {
    expect(multiplierFor('gold', tiers)).toBe(1.5)
    expect(multiplierFor('bronze', tiers)).toBe(1)
    expect(multiplierFor('gold', [BASE_TIER])).toBe(1)
  })
})
