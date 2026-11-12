// Types and time-series helpers for the product analytics page.

export interface AnalyticsData {
  product: {
    id: string
    name: string
    sku: string
    slug: string
    brandName: string | null
    stock: number
    basePrice: number
  }
  days: number
  totals: {
    views: number
    uniqueViewers: number
    cartAdds: number
    orders: number
    revenue: number
    quantitySold: number
    conversionRate: number
    cartConversionRate: number
    revenuePerView: number
    activeCarts: number
  }
  timeSeries: TrafficRow[]
  referrers: Referrer[]
  recentBuyers: Buyer[]
  variantBreakdown: VariantSales[]
}

export type Granularity = 'daily' | 'weekly' | 'monthly'
export type TrafficRow = { date: string; views: number; carts: number; orders: number }
export type Referrer = { referrer: string; sessions: number }
export type Buyer = { orderNumber: string; createdAt: string; quantity: number; total: number; customerName: string }
export type VariantSales = { variantName: string | null; orders: number; quantity: number; revenue: number }

export const RANGES = [7, 14, 30, 60, 90]
export const PREVIEW = 5
export const GRANULARITIES: { id: Granularity; label: string; plural: string }[] = [
  { id: 'daily', label: 'Day', plural: 'days' },
  { id: 'weekly', label: 'Week', plural: 'weeks' },
  { id: 'monthly', label: 'Month', plural: 'months' },
]

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** Daily rows summed into weeks (Monday start) or months. */
export function aggregate(series: TrafficRow[], mode: Granularity): TrafficRow[] {
  if (mode === 'daily') return series

  const buckets = new Map<string, TrafficRow>()

  for (const r of series) {
    const d = new Date(r.date)
    let key: string

    if (mode === 'monthly') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    } else {
      const day = d.getDay() === 0 ? 6 : d.getDay() - 1
      const mon = new Date(d)
      mon.setDate(d.getDate() - day)
      key = mon.toISOString().slice(0, 10)
    }

    const existing = buckets.get(key)
    if (existing) {
      existing.views += r.views
      existing.carts += r.carts
      existing.orders += r.orders
    } else {
      buckets.set(key, { date: key, views: r.views, carts: r.carts, orders: r.orders })
    }
  }

  return Array.from(buckets.values())
}

export function fmtLabel(date: string, mode: Granularity): string {
  const d = new Date(date)
  if (mode === 'monthly') {
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  }
  if (mode === 'weekly') {
    const sun = new Date(d)
    sun.setDate(d.getDate() + 6)
    const fmt = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    return `${fmt(d)} – ${fmt(sun)}`
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
