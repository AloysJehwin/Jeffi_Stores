import {
  INTERVAL_SPEC,
  MAX_CYCLE_AMOUNT_INR,
  SUBSCRIPTION_INTERVALS,
  isSubscriptionInterval,
  type SubscriptionInterval,
} from './intervals'

// Sellable rule: no variants → the product; variants → each variant, except a variant
// with active sub-variants, which sells only its sub-variants.

export type SellableKind = 'product' | 'variant' | 'sub_variant'

export interface SellableItem {
  key: string
  kind: SellableKind
  variantId: string | null
  subVariantId: string | null
  name: string
  sku: string
  oneTimePrice: number | null
  subscriptionPrice: string
  /** interval → admin input string (blank = fall back). */
  subscriptionPrices: Record<string, string>
}

interface VariantLike {
  id?: string | null
  variant_name?: string | null
  sku?: string | null
  price?: string | number | null
  subscription_price?: string | number | null
  subscription_prices?: unknown
  sub_variant_type_on?: boolean | null
  _isDeleted?: boolean
  is_active?: boolean | null
}

interface SubVariantLike {
  id?: string | null
  sub_variant_name?: string | null
  sku?: string | null
  price?: string | number | null
  subscription_price?: string | number | null
  subscription_prices?: unknown
  is_active?: boolean | null
  _cleared?: boolean
}

const str = (x: unknown) => (x == null ? '' : String(x))
const num = (x: unknown): number | null => {
  if (x == null || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

export function deriveSellableItems(input: {
  hasVariants: boolean
  product: { name?: string | null; sku?: string | null; price?: string | number | null; subscription_price?: unknown; subscription_prices?: unknown }
  variants: VariantLike[]
  subVariantsByVariant: Record<string, SubVariantLike[] | undefined>
}): SellableItem[] {
  const live = input.hasVariants ? input.variants.filter(v => !v._isDeleted && v.is_active !== false) : []
  if (live.length === 0) {
    return [
      {
        key: 'product',
        kind: 'product',
        variantId: null,
        subVariantId: null,
        name: str(input.product.name) || 'This product',
        sku: str(input.product.sku),
        oneTimePrice: num(input.product.price),
        subscriptionPrice: str(input.product.subscription_price),
        subscriptionPrices: priceInputs(input.product.subscription_prices),
      },
    ]
  }
  const out: SellableItem[] = []
  for (const v of live) {
    const vid = str(v.id)
    const subs = v.sub_variant_type_on
      ? (input.subVariantsByVariant[vid] ?? []).filter(
          sv => !sv._cleared && sv.is_active !== false && sv.sub_variant_name
        )
      : []
    if (subs.length > 0) {
      for (const sv of subs) {
        out.push({
          key: `sv:${str(sv.id)}`,
          kind: 'sub_variant',
          variantId: vid,
          subVariantId: str(sv.id),
          name: `${str(v.variant_name)} / ${str(sv.sub_variant_name)}`,
          sku: str(sv.sku),
          oneTimePrice: num(sv.price) ?? num(v.price),
          subscriptionPrice: str(sv.subscription_price),
          subscriptionPrices: priceInputs(sv.subscription_prices),
        })
      }
    } else {
      out.push({
        key: `v:${vid}`,
        kind: 'variant',
        variantId: vid,
        subVariantId: null,
        name: str(v.variant_name) || 'Untitled variant',
        sku: str(v.sku),
        oneTimePrice: num(v.price),
        subscriptionPrice: str(v.subscription_price),
        subscriptionPrices: priceInputs(v.subscription_prices),
      })
    }
  }
  return out
}

/** "12% less" / "5% more" vs one-time; null when either side is missing or equal. */
export function subscriptionPriceHint(oneTime: number | null, subscription: string | number | null): string | null {
  const sub = num(subscription)
  if (oneTime == null || oneTime <= 0 || sub == null || sub <= 0) return null
  const pct = Math.round(((oneTime - sub) / oneTime) * 100)
  if (pct === 0) return null
  return pct > 0 ? `${pct}% less` : `${-pct}% more`
}

/** Percent saved vs one-time, or 0 when the subscription is not cheaper. */
export function subscriptionSavingsPct(oneTime: number, unit: number): number {
  if (!(oneTime > 0) || !(unit < oneTime)) return 0
  return Math.round(((oneTime - unit) / oneTime) * 100)
}

/** Admin input → stored value: positive amount rounded to paise, else null (= one-time price). */
export function normalizeSubscriptionPrice(x: unknown): number | null {
  const n = num(typeof x === 'string' ? x.trim() : x)
  if (n == null || n <= 0) return null
  return Math.round(n * 100) / 100
}

function parseMap(x: unknown): Record<string, unknown> {
  let v = x
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return {}
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Stored/DB map → form input strings per interval. */
export function priceInputs(x: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parseMap(x))) if (isSubscriptionInterval(k) && v != null && v !== '') out[k] = String(v)
  return out
}

/** Admin input (object or JSON) → stored jsonb: known intervals with a positive amount, rounded to paise. */
export function normalizeSubscriptionPrices(x: unknown): Partial<Record<SubscriptionInterval, number>> {
  const out: Partial<Record<SubscriptionInterval, number>> = {}
  const m = parseMap(x)
  for (const k of SUBSCRIPTION_INTERVALS) {
    const n = normalizeSubscriptionPrice(m[k])
    if (n != null) out[k] = n
  }
  return out
}

/** Per-cycle GST-inclusive price for an interval: per-interval, else legacy scalar, else null (one-time). */
export function pickSubscriptionPrice(
  prices: unknown,
  legacy: unknown,
  interval: SubscriptionInterval
): number | null {
  return normalizeSubscriptionPrices(prices)[interval] ?? normalizeSubscriptionPrice(legacy)
}

/** Admin cell validation; null when OK or blank. */
export function subscriptionPriceError(x: unknown): string | null {
  if (x == null || (typeof x === 'string' && x.trim() === '')) return null
  const n = Number(typeof x === 'string' ? x.trim() : x)
  if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative amount'
  if (n > MAX_CYCLE_AMOUNT_INR) return `Max ₹${MAX_CYCLE_AMOUNT_INR.toLocaleString('en-IN')} per cycle`
  return null
}

const MONTHS_PER_CYCLE: Record<SubscriptionInterval, number | null> = {
  weekly: null,
  monthly: null,
  quarterly: INTERVAL_SPEC.quarterly.interval,
  yearly: 12,
}

/** "₹1,333/mo" for quarterly/yearly cycles; null otherwise. */
export function monthlyEquivalentLabel(interval: SubscriptionInterval, perCycle: unknown): string | null {
  const months = MONTHS_PER_CYCLE[interval]
  const n = normalizeSubscriptionPrice(perCycle)
  if (!months || n == null) return null
  return `₹${Math.round(n / months).toLocaleString('en-IN')}/mo`
}
