import { queryOne, queryMany, type RevenuePeriod } from './shared'
import { getStockValuation } from '../inventory'

export interface RevenueTrend {
  months: string[]
  series: Array<{ source: string; label: string; color: string; points: number[] }>
}

const REVENUE_SOURCES: Array<{ source: string; label: string; color: string }> = [
  { source: 'online', label: 'Online', color: '#3b82f6' }, // blue
  { source: 'business', label: 'Business', color: '#22c55e' }, // green
  { source: 'offline', label: 'Offline', color: '#a855f7' }, // purple
  { source: 'cash_sale', label: 'Cash Sale', color: '#f59e0b' }, // amber
]


// Monthly paid-revenue trend split by order source, for the requested period. Pivoted
// server-side into one continuous (zero-filled) points array per source, aligned to a shared
// months axis.
export async function getRevenueTrendBySource(period: RevenuePeriod = '12m'): Promise<RevenueTrend> {
  // Resolve the window's start month (inclusive) as a Date at day 1.
  const now = new Date()
  const startOfMonth = (y: number, m: number) => new Date(y, m, 1)
  let start: Date
  if (period === '3m') start = startOfMonth(now.getFullYear(), now.getMonth() - 2)
  else if (period === '6m') start = startOfMonth(now.getFullYear(), now.getMonth() - 5)
  else if (period === 'ytd') start = startOfMonth(now.getFullYear(), 0)
  else if (period === 'all')
    start = new Date(0) // resolved to first-order month below
  else start = startOfMonth(now.getFullYear(), now.getMonth() - 11) // 12m default

  // For 'all', anchor the axis to the earliest paid order.
  if (period === 'all') {
    const first = await queryOne<{ m: string }>(
      `SELECT to_char(date_trunc('month', min(created_at)), 'YYYY-MM') AS m
         FROM orders WHERE payment_status = 'paid'`
    ).catch(() => null)
    if (first?.m) {
      const [y, mm] = first.m.split('-').map(Number)
      start = startOfMonth(y, mm - 1)
    } else {
      start = startOfMonth(now.getFullYear(), now.getMonth() - 11)
    }
  }

  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  const rows = await queryMany<{ month: string; source: string; revenue: number }>(
    `
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           source,
           SUM(total_amount)::float AS revenue
      FROM orders
     WHERE payment_status = 'paid'
       AND created_at >= $1::date
     GROUP BY 1, 2
     ORDER BY 1
  `,
    [startStr]
  ).catch(() => [])

  // Continuous month axis from `start` through the current month.
  const months: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const monthIndex = new Map(months.map((m, idx) => [m, idx]))

  const bySource = new Map<string, number[]>()
  for (const s of REVENUE_SOURCES) bySource.set(s.source, new Array(months.length).fill(0))
  for (const r of rows) {
    const arr = bySource.get(r.source)
    const idx = monthIndex.get(r.month)
    if (arr && idx !== undefined) arr[idx] = Number(r.revenue) || 0
  }

  const series = REVENUE_SOURCES.map(s => ({ ...s, points: bySource.get(s.source)! }))
  return { months, series }
}

export interface BreakdownSlice {
  label: string
  value: number
  color: string
}

export interface ProductStats {
  totalProducts: number
  activeProducts: number
  featured: number
  categories: number
  inventoryValue: number // Σ (price × inventory_quantity): variants for has_variants, base for simple
  byCategory: BreakdownSlice[]
  byBrand: BreakdownSlice[]
  byStock: BreakdownSlice[]
  byInventoryValue: BreakdownSlice[] // Σ base_price split by stock status (₹)
}

// Categorical palette for the product breakdown bars (brand-neutral, light/dark safe).
const BREAKDOWN_PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#f97316',
]

// Cap a grouped result to top-N slices + an aggregated "Other" bucket, and colorize.
function toSlices(rows: Array<{ label: string | null; count: number }>, topN = 8): BreakdownSlice[] {
  const cleaned = rows.map(r => ({ label: r.label || 'Uncategorized', value: Number(r.count) || 0 }))
  const top = cleaned.slice(0, topN)
  const rest = cleaned.slice(topN)
  if (rest.length) top.push({ label: 'Other', value: rest.reduce((s, r) => s + r.value, 0) })
  return top.map((s, i) => ({ ...s, color: BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length] }))
}

// All the header metrics + three categorical breakdowns for the Products page, in one call.
export async function getProductBreakdowns(): Promise<ProductStats> {
  const [summary, invValue, catRows, brandRows, stockRows, invValueRows] = await Promise.all([
    queryOne<{ total: number; active: number; featured: number; categories: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active)::int AS active,
        COUNT(*) FILTER (WHERE is_featured)::int AS featured,
        (SELECT COUNT(*)::int FROM categories WHERE is_active) AS categories
      FROM products
      WHERE is_draft = false
    `),
    // True inventory stock value — reuse the canonical valuation (ex-GST, covers products +
    // variants + sub-variants) so this matches the Stock Ledger → Valuation page exactly.
    getStockValuation()
      .then(v => ({ inv_value: v.totalValue }))
      .catch(() => ({ inv_value: 0 })),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(top.name, 'Uncategorized') AS label, COUNT(*)::int AS count
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories top ON top.id = COALESCE(c.parent_category_id, c.id)
       WHERE p.is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(b.name, 'No Brand') AS label, COUNT(*)::int AS count
        FROM products p LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(stock_status, 'Unknown') AS label, COUNT(*)::int AS count
        FROM products WHERE is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    // Top products by catalog value (base_price) — the "Inventory Value" breakdown.
    queryMany<{ label: string | null; count: number }>(`
      SELECT name AS label, COALESCE(base_price, 0)::float AS count
        FROM products WHERE is_active AND base_price > 0
       ORDER BY base_price DESC
       LIMIT 10
    `),
  ])

  return {
    totalProducts: Number(summary?.total) || 0,
    activeProducts: Number(summary?.active) || 0,
    featured: Number(summary?.featured) || 0,
    categories: Number(summary?.categories) || 0,
    inventoryValue: Number(invValue?.inv_value) || 0,
    byCategory: toSlices(catRows),
    byBrand: toSlices(brandRows),
    byStock: toSlices(stockRows, 5),
    byInventoryValue: invValueRows.map((r, i) => ({
      label: r.label || 'Unnamed',
      value: Number(r.count) || 0,
      color: BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length],
    })),
  }
}

// ── Customer stats + engagement (admin /customers page) ──────────────────────

export interface CustomerStats {
  total: number
  active: number
  inactive: number
  flagged: number
}

// Real COUNT-based stats over all non-guest customers (matches getCustomers' filter).
export async function getCustomerStats(): Promise<CustomerStats> {
  const row = await queryOne<CustomerStats>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_active AND NOT is_flagged)::int AS active,
      COUNT(*) FILTER (WHERE NOT is_active AND NOT is_flagged)::int AS inactive,
      COUNT(*) FILTER (WHERE is_flagged)::int AS flagged
    FROM users
    WHERE is_guest = false
  `)
  return row ?? { total: 0, active: 0, inactive: 0, flagged: 0 }
}

// Engagement segments (VIP / loyal / repeat / one-time / new / at-risk / dormant / lead)
// derived from order history — mirrors the CRM segment SQL.
export async function getCustomerSegments(): Promise<BreakdownSlice[]> {
  const row = await queryOne<{
    vip: number
    loyal: number
    repeat: number
    one_time: number
    new: number
    at_risk: number
    dormant: number
    lead: number
  }>(`
    WITH agg AS (
      SELECT
        u.id, u.created_at,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.paid_orders, 0) AS paid_orders,
        COALESCE(o.lifetime_value, 0) AS ltv,
        o.last_order_at
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               SUM(total_amount) AS lifetime_value,
               MAX(created_at) AS last_order_at
        FROM orders GROUP BY user_id
      ) o ON o.user_id = u.id
      WHERE u.is_guest = false
    )
    SELECT
      COUNT(*) FILTER (WHERE ltv >= 50000)::int AS vip,
      COUNT(*) FILTER (WHERE paid_orders >= 5 AND ltv >= 25000)::int AS loyal,
      COUNT(*) FILTER (WHERE order_count >= 3)::int AS repeat,
      COUNT(*) FILTER (WHERE order_count = 1)::int AS one_time,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new,
      COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '90 days' AND last_order_at >= NOW() - INTERVAL '180 days')::int AS at_risk,
      COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '180 days')::int AS dormant,
      COUNT(*) FILTER (WHERE order_count = 0)::int AS lead
    FROM agg
  `)
  const s = row ?? { vip: 0, loyal: 0, repeat: 0, one_time: 0, new: 0, at_risk: 0, dormant: 0, lead: 0 }
  return [
    { label: 'VIP', value: s.vip, color: '#8b5cf6' },
    { label: 'Loyal', value: s.loyal, color: '#3b82f6' },
    { label: 'Repeat', value: s.repeat, color: '#10b981' },
    { label: 'One-time', value: s.one_time, color: '#14b8a6' },
    { label: 'New', value: s.new, color: '#22c55e' },
    { label: 'At risk', value: s.at_risk, color: '#f59e0b' },
    { label: 'Dormant', value: s.dormant, color: '#ef4444' },
    { label: 'Lead', value: s.lead, color: '#94a3b8' },
  ]
}

// Notification-channel preference mix across non-guest customers.
export async function getCustomerChannelMix(): Promise<BreakdownSlice[]> {
  const rows = await queryMany<{ channel: string | null; count: string }>(`
    SELECT notification_channel AS channel, COUNT(*)::int AS count
    FROM users
    WHERE is_guest = false
    GROUP BY notification_channel
  `)
  const colors: Record<string, string> = { email: '#3b82f6', sms: '#10b981', whatsapp: '#22c55e' }
  const labels: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }
  return rows
    .map(r => {
      const key = (r.channel || 'email').toLowerCase()
      return {
        label: labels[key] || r.channel || 'Email',
        value: Number(r.count) || 0,
        color: colors[key] || '#94a3b8',
      }
    })
    .sort((a, b) => b.value - a.value)
}
