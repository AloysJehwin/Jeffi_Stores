import { queryOne } from '@/lib/shared/db'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import type { DateRange } from './queries'

// Our side of the ROAS: orders that arrived from a Google Ads click (orders.gclid / gbraid / wbraid,
// captured at checkout). Revenue is what the customer actually paid on non-cancelled orders,
// less completed return refunds; profit subtracts tax and cost of goods (cost_price).

const colCache = new Map<string, boolean>()

/** Whether this DB's orders table has the click-id columns (added by the attribution rollout). */
export async function hasAttributionColumns(): Promise<boolean> {
  const key = getCurrentTenantId() ?? 'platform'
  const cached = colCache.get(key)
  if (cached !== undefined) return cached
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name IN ('gclid', 'gbraid', 'wbraid')`
  ).catch(() => null)
  const ok = (row?.n ?? 0) === 3
  // Only remember a yes: a missing column may appear on the next deploy.
  if (ok) colCache.set(key, true)
  return ok
}

export function _resetAttributionCache() {
  colCache.clear()
}

export interface AdsOrderStats {
  available: boolean
  orders: number
  revenue: number
  refunds: number
  tax: number
  cogs: number
}

export interface ReturnMetrics {
  netRevenue: number
  grossProfit: number
  /** Revenue / spend from our own orders; null when there was no spend. */
  trueRoas: number | null
  /** Gross profit / spend; null when there was no spend. */
  poas: number | null
  /** Profit left after paying for the ads. */
  profitAfterAds: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeReturnMetrics(spend: number, s: Pick<AdsOrderStats, 'revenue' | 'refunds' | 'tax' | 'cogs'>): ReturnMetrics {
  const netRevenue = Math.max(0, s.revenue - s.refunds)
  const grossProfit = s.revenue - s.tax - s.refunds - s.cogs
  return {
    netRevenue: round2(netRevenue),
    grossProfit: round2(grossProfit),
    trueRoas: spend > 0 ? round2(netRevenue / spend) : null,
    poas: spend > 0 ? round2(grossProfit / spend) : null,
    profitAfterAds: round2(grossProfit - spend),
  }
}

export async function googleAdsOrderStats(range: DateRange, timeZone = 'Asia/Kolkata'): Promise<AdsOrderStats> {
  if (!(await hasAttributionColumns())) return { available: false, orders: 0, revenue: 0, refunds: 0, tax: 0, cogs: 0 }
  const row = await queryOne<{ orders: number; revenue: string; tax: string; cogs: string; refunds: string }>(
    `WITH ads_orders AS (
       SELECT o.id, o.total_amount, COALESCE(o.tax_amount, 0) AS tax_amount
       FROM orders o
       WHERE (o.gclid IS NOT NULL OR o.gbraid IS NOT NULL OR o.wbraid IS NOT NULL)
         AND o.payment_status = 'paid'
         AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
         AND (o.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
     )
     SELECT
       (SELECT COUNT(*)::int FROM ads_orders) AS orders,
       (SELECT COALESCE(SUM(total_amount), 0) FROM ads_orders) AS revenue,
       (SELECT COALESCE(SUM(tax_amount), 0) FROM ads_orders) AS tax,
       (SELECT COALESCE(SUM(oi.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
          FROM order_items oi
          JOIN ads_orders ao ON ao.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id) AS cogs,
       (SELECT COALESCE(SUM(ri.refund_amount), 0)
          FROM return_requests rr
          JOIN ads_orders ao ON ao.id = rr.order_id
          JOIN return_request_items ri ON ri.return_request_id = rr.id
          WHERE rr.status = 'completed') AS refunds`,
    [range.from, range.to, timeZone]
  )
  return {
    available: true,
    orders: row?.orders ?? 0,
    revenue: Number(row?.revenue ?? 0),
    refunds: Number(row?.refunds ?? 0),
    tax: Number(row?.tax ?? 0),
    cogs: Number(row?.cogs ?? 0),
  }
}
