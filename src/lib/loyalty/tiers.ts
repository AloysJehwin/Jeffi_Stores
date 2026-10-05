export const TIER_KEYS = ['bronze', 'silver', 'gold', 'platinum'] as const
export type TierKey = (typeof TIER_KEYS)[number]

export const TIER_NAMES: Record<TierKey, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
}

export interface LoyaltyTier {
  key: TierKey
  name: string
  minPoints: number
  multiplier: number
}

export const BASE_TIER: LoyaltyTier = { key: 'bronze', name: TIER_NAMES.bronze, minPoints: 0, multiplier: 1 }

export function tierRank(key: string | null | undefined): number {
  const index = TIER_KEYS.indexOf(key as TierKey)
  return index < 0 ? 0 : index
}

export function tierName(key: string | null | undefined): string {
  return TIER_NAMES[TIER_KEYS[tierRank(key)]]
}

export function tierForPoints(lifetimePoints: number, tiers: LoyaltyTier[]): LoyaltyTier {
  const points = Math.max(0, lifetimePoints)
  let current = tiers[0] ?? BASE_TIER
  for (const tier of tiers) {
    if (points >= tier.minPoints && tierRank(tier.key) >= tierRank(current.key)) current = tier
  }
  return current
}

export function nextTierAfter(key: string | null | undefined, tiers: LoyaltyTier[]): LoyaltyTier | null {
  const rank = tierRank(key)
  return tiers.find(tier => tierRank(tier.key) === rank + 1) ?? null
}

export function multiplierFor(key: string | null | undefined, tiers: LoyaltyTier[]): number {
  const rank = tierRank(key)
  return tiers.find(tier => tierRank(tier.key) === rank)?.multiplier ?? 1
}
