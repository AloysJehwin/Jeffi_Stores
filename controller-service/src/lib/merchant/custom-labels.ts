// Merchant Center custom labels for bidding, sent with every feed item and used as listing-group
// dimensions in Google Ads: 0 = margin band, 1 = sales velocity, 2 = stock state. Values are
// lower-case because Google matches custom attributes case-insensitively and reports them lower-cased.

export const MARGIN_LABELS = ['margin-high', 'margin-medium', 'margin-low', 'margin-negative', 'margin-unknown'] as const
export const VELOCITY_LABELS = ['bestseller', 'steady', 'new', 'slow-mover'] as const
export const STOCK_LABELS = ['in-stock', 'low-stock', 'out-of-stock'] as const

export type MarginLabel = (typeof MARGIN_LABELS)[number]
export type VelocityLabel = (typeof VELOCITY_LABELS)[number]
export type StockLabel = (typeof STOCK_LABELS)[number]

/** customLabel index per dimension (Google's INDEX0..INDEX4). */
export const LABEL_INDEX = { margin: 0, velocity: 1, stock: 2 } as const

export const VELOCITY_WINDOW_DAYS = 60
const BESTSELLER_SHARE = 0.2
const MIN_BESTSELLER_UNITS = 2

const num = (v: unknown): number | null => {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? null : n
}

/** Gross margin on the ex-tax selling price: high >= 40%, medium >= 20%, low >= 0, else negative. */
export function marginBand(price: unknown, cost: unknown): MarginLabel {
  const p = num(price)
  const c = num(cost)
  if (p == null || c == null || p <= 0 || c <= 0) return 'margin-unknown'
  const m = (p - c) / p
  if (m < 0) return 'margin-negative'
  if (m < 0.2) return 'margin-low'
  if (m < 0.4) return 'margin-medium'
  return 'margin-high'
}

export interface SalesVelocity {
  /** Units sold per lower-cased SKU in the window. */
  unitsBySku: Map<string, number>
  /** Fewest units that still count as a best seller (top 20% of selling SKUs). */
  bestsellerMin: number
  windowDays: number
  now: Date
}

export function buildVelocity(units: { sku: string; units: number }[], windowDays = VELOCITY_WINDOW_DAYS, now = new Date()): SalesVelocity {
  const unitsBySku = new Map<string, number>()
  for (const u of units) {
    if (!u.sku || !(u.units > 0)) continue
    const k = u.sku.toLowerCase()
    unitsBySku.set(k, (unitsBySku.get(k) ?? 0) + u.units)
  }
  const sorted = [...unitsBySku.values()].sort((a, b) => b - a)
  const top = sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * BESTSELLER_SHARE) - 1)] : Infinity
  return { unitsBySku, bestsellerMin: Math.max(MIN_BESTSELLER_UNITS, top), windowDays, now }
}

export function velocityLabel(sku: string | null | undefined, createdAt: unknown, v: SalesVelocity): VelocityLabel {
  const units = sku ? v.unitsBySku.get(sku.toLowerCase()) ?? 0 : 0
  if (units >= v.bestsellerMin) return 'bestseller'
  if (units > 0) return 'steady'
  const created = createdAt ? new Date(String(createdAt)).getTime() : NaN
  if (Number.isFinite(created) && v.now.getTime() - created < v.windowDays * 86_400_000) return 'new'
  return 'slow-mover'
}

export function stockLabel(stockStatus: unknown, quantity: unknown, lowThreshold?: unknown): StockLabel {
  if (stockStatus === 'Out of Stock') return 'out-of-stock'
  if (stockStatus === 'Low Stock') return 'low-stock'
  if (stockStatus === 'In Stock') return 'in-stock'
  const q = num(quantity)
  if (q == null) return 'in-stock'
  if (q <= 0) return 'out-of-stock'
  const low = num(lowThreshold)
  return low != null && q <= low ? 'low-stock' : 'in-stock'
}

export interface ItemLabels {
  customLabel0: MarginLabel
  customLabel1?: VelocityLabel
  customLabel2: StockLabel
}

/** Labels for one feed item (a variant, or a product without variants). */
export function itemLabels(
  item: { sku: string; priceExTax: unknown; cost: unknown; stockStatus: unknown; quantity: unknown; lowThreshold?: unknown; createdAt?: unknown },
  velocity?: SalesVelocity
): ItemLabels {
  return {
    customLabel0: marginBand(item.priceExTax, item.cost),
    ...(velocity ? { customLabel1: velocityLabel(item.sku, item.createdAt, velocity) } : {}),
    customLabel2: stockLabel(item.stockStatus, item.quantity, item.lowThreshold),
  }
}
