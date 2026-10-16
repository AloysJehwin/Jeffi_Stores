// Repricer maths (pure). Amazon prices are GST-inclusive; our cost is ex GST. A price is never
// proposed below the floor: the rule's min price and the margin floor, the lowest price at which
// (price ex GST - Amazon fees - cost) still leaves min_margin_pct of the price ex GST.

export type Strategy = 'match_buybox' | 'beat_buybox' | 'hold'

export interface RepricerRule {
  id: string
  sku: string | null
  strategy: Strategy
  beatBy: number
  minPrice: number | null
  maxPrice: number | null
  minMarginPct: number
  autoApply: boolean
  enabled: boolean
}

export interface PriceInputs {
  sku: string
  price: number
  /** Price ex GST / price, from our catalogue (1 when unknown). */
  exRatio: number
  cost: number | null
  buyboxPrice: number | null
  buyboxIsOurs: boolean | null
  /** Referral fee as a share of price, and the fees that do not scale with price. */
  referralRate: number
  fixedFees: number
}

export interface Proposal {
  sku: string
  ruleId: string
  current: number
  target: number
  floor: number | null
  reason: string
  autoApply: boolean
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Lowest price that keeps the margin, or null when cost is unknown. */
export function marginFloor(i: Pick<PriceInputs, 'exRatio' | 'cost' | 'referralRate' | 'fixedFees'>, minMarginPct: number): number | null {
  if (i.cost == null) return null
  const k = i.exRatio * (1 - minMarginPct / 100) - i.referralRate
  if (k <= 0) return null
  return Math.ceil(((i.fixedFees + i.cost) / k) * 100) / 100
}

export function ruleFor(rules: RepricerRule[], sku: string): RepricerRule | null {
  return rules.find(r => r.enabled && r.sku === sku) ?? rules.find(r => r.enabled && r.sku == null) ?? null
}

export function propose(i: PriceInputs, rule: RepricerRule): Proposal | null {
  if (rule.strategy === 'hold' || i.buyboxPrice == null || i.buyboxIsOurs) return null
  const want = rule.strategy === 'beat_buybox' ? i.buyboxPrice - rule.beatBy : i.buyboxPrice
  const mf = marginFloor(i, rule.minMarginPct)
  const floor = Math.max(rule.minPrice ?? 0, mf ?? 0) || null
  let target = r2(want)
  let reason = rule.strategy === 'beat_buybox' ? `Beat the Buy Box (${r2(i.buyboxPrice)}) by ${rule.beatBy}` : `Match the Buy Box (${r2(i.buyboxPrice)})`
  if (floor != null && target < floor) {
    target = floor
    reason = `${reason}; held at the floor ${floor}`
  }
  if (rule.maxPrice != null && target > rule.maxPrice) {
    target = rule.maxPrice
    reason = `${reason}; capped at ${rule.maxPrice}`
  }
  if (Math.abs(target - i.price) < 0.5) return null
  return { sku: i.sku, ruleId: rule.id, current: i.price, target, floor, reason, autoApply: rule.autoApply }
}

/** Margin per unit at a price, before GST on fees (claimable as input credit). */
export function marginAt(price: number, i: Pick<PriceInputs, 'exRatio' | 'cost' | 'referralRate' | 'fixedFees'>): number | null {
  if (i.cost == null) return null
  return r2(price * i.exRatio - (i.referralRate * price + i.fixedFees) - i.cost)
}
