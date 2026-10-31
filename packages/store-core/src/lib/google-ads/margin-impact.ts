import { queryMany, queryOne } from '@/lib/shared/db'
import { computeReturnMetrics, googleAdsOrderStats } from './attribution'
import { dateInZone } from './sync'

// Our view of a Google recommendation: what the extra conversions Google forecasts are worth in
// profit at the store's own margin (cost_price), less the extra spend; the break-even ROAS / CPA
// for bid-target changes; and a warning when the campaign spends on items that are out of stock.

export interface Economics {
  /** Order value we expect per conversion (net revenue / orders from Google clicks, else store-wide). */
  aov: number | null
  /** Gross profit / net revenue. */
  marginRate: number | null
  /** Where the numbers came from: our Google-attributed orders or every paid order. */
  basis: 'ads_orders' | 'all_orders' | 'none'
}

export interface RecImpactInput {
  type: string | null
  extraConversions: number | null
  extraCost: number | null
  extraValue?: number | null
}

export interface MarginImpact {
  profitImpact: number | null
  verdict: 'gain' | 'loss' | 'neutral' | null
  breakEvenRoas: number | null
  breakEvenCpa: number | null
  note: string | null
  stockConflict: string | null
}

const BID_TARGET = /TARGET_ROAS|TARGET_CPA|MAXIMIZE_CONVERSION|MAXIMIZE_CLICKS|ENHANCED_CPC/
const ROAS_TYPES = /ROAS|CONVERSION_VALUE/
/** Recommendations that buy more traffic for the campaign. */
const MORE_SPEND = /BUDGET|KEYWORD|BROAD_MATCH|SEARCH_PARTNERS|DISPLAY_EXPANSION|RAISE_TARGET_CPA|LOWER_TARGET_ROAS|MAXIMIZE/

const round2 = (v: number) => Math.round(v * 100) / 100

export function marginImpact(rec: RecImpactInput, econ: Economics, oosShare: number | null = null): MarginImpact {
  const m = econ.marginRate
  const breakEvenRoas = m != null && m > 0 ? round2(1 / m) : null
  const breakEvenCpa = m != null && m > 0 && econ.aov != null ? round2(econ.aov * m) : null
  let profitImpact: number | null = null
  const cost = rec.extraCost ?? 0
  if (m != null) {
    if (rec.extraConversions != null && econ.aov != null) profitImpact = round2(rec.extraConversions * econ.aov * m - cost)
    else if (rec.extraValue != null) profitImpact = round2(rec.extraValue * m - cost)
  }
  const verdict = profitImpact == null ? null : profitImpact > 0.5 ? 'gain' : profitImpact < -0.5 ? 'loss' : 'neutral'
  let note: string | null = null
  const type = rec.type ?? ''
  if (BID_TARGET.test(type) && breakEvenRoas != null) {
    note = ROAS_TYPES.test(type)
      ? `Break-even ROAS at your margin is ${breakEvenRoas}x; keep any target above it.`
      : breakEvenCpa != null
        ? `Break-even cost per sale at your margin is ${breakEvenCpa}; keep any target below it.`
        : null
  } else if (m == null) note = 'Add cost prices to products to see the profit effect.'
  const stockConflict =
    oosShare != null && oosShare >= 0.25 && MORE_SPEND.test(type)
      ? `${Math.round(oosShare * 100)}% of this campaign's product spend is on out-of-stock items`
      : null
  return { profitImpact, verdict, breakEvenRoas, breakEvenCpa, note, stockConflict }
}

/** The store's margin and order value: Google-attributed orders first, every paid order as the fallback. */
export async function loadEconomics(days = 90, now = new Date()): Promise<Economics> {
  const acc = await queryOne<{ time_zone: string | null }>(`SELECT time_zone FROM ads_account WHERE id = 1`).catch(() => null)
  const tz = acc?.time_zone || 'Asia/Kolkata'
  const to = dateInZone(now, tz)
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const range = { from: start.toISOString().slice(0, 10), to }
  const ads = await googleAdsOrderStats(range, tz).catch(() => null)
  if (ads?.available && ads.orders >= 3) {
    const r = computeReturnMetrics(0, ads)
    if (r.netRevenue > 0) return { aov: round2(r.netRevenue / ads.orders), marginRate: Math.round((r.grossProfit / r.netRevenue) * 1000) / 1000, basis: 'ads_orders' }
  }
  const all = await queryOne<{ orders: number; revenue: string; tax: string; cogs: string; costed: string }>(
    `WITH o AS (
       SELECT o.id, o.total_amount, COALESCE(o.tax_amount, 0) AS tax_amount FROM orders o
       WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
         AND o.created_at >= now() - make_interval(days => $1)
     )
     SELECT (SELECT COUNT(*)::int FROM o) AS orders,
            (SELECT COALESCE(SUM(total_amount), 0) FROM o) AS revenue,
            (SELECT COALESCE(SUM(tax_amount), 0) FROM o) AS tax,
            (SELECT COALESCE(SUM(oi.quantity * COALESCE(NULLIF(pv.cost_price, 0), p.cost_price, 0)), 0)
               FROM order_items oi JOIN o ON o.id = oi.order_id
               LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN product_variants pv ON pv.id = oi.variant_id) AS cogs,
            (SELECT COALESCE(SUM(oi.total_price) FILTER (WHERE COALESCE(NULLIF(pv.cost_price, 0), p.cost_price, 0) > 0), 0)
                    / NULLIF(SUM(oi.total_price), 0)
               FROM order_items oi JOIN o ON o.id = oi.order_id
               LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN product_variants pv ON pv.id = oi.variant_id) AS costed`,
    [days]
  ).catch(() => null)
  const orders = all?.orders ?? 0
  const revenue = Number(all?.revenue ?? 0)
  // Without cost prices on most of what sold the margin would read as ~100%.
  if (!orders || revenue <= 0 || Number(all?.costed ?? 0) < 0.5) return { aov: orders ? round2(revenue / orders) : null, marginRate: null, basis: orders ? 'all_orders' : 'none' }
  const profit = revenue - Number(all?.tax ?? 0) - Number(all?.cogs ?? 0)
  return { aov: round2(revenue / orders), marginRate: Math.round((profit / revenue) * 1000) / 1000, basis: 'all_orders' }
}

const OFFER_ID_SQL = (col: string) => `lower(regexp_replace(${col}, '[^a-zA-Z0-9_:.-]', '_', 'g'))`

/** Per campaign: share of the last 30 days' product spend on items that are out of stock now. */
export async function outOfStockShare(campaignIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(campaignIds.filter(v => /^\d+$/.test(v)))]
  const out = new Map<string, number>()
  if (!ids.length) return out
  const rows = await queryMany<{ campaign_id: string; total: string; oos: string }>(
    `WITH m AS (
       SELECT campaign_id, item_id, SUM(cost_micros) AS cost FROM ads_product_metrics
       WHERE campaign_id = ANY($1::bigint[]) AND date >= current_date - 30 GROUP BY campaign_id, item_id
     )
     SELECT m.campaign_id::text, SUM(m.cost) AS total,
            SUM(m.cost) FILTER (WHERE x.out) AS oos
     FROM m LEFT JOIN LATERAL (
       SELECT (v.stock_status = 'Out of Stock' OR (v.stock_status IS NULL AND v.inventory_quantity <= 0)) AS out
       FROM product_variants v WHERE ${OFFER_ID_SQL('v.sku')} = m.item_id
       UNION ALL
       SELECT (p.stock_status = 'Out of Stock' OR (p.stock_status IS NULL AND p.inventory_quantity <= 0))
       FROM products p WHERE ${OFFER_ID_SQL('p.sku')} = m.item_id
       LIMIT 1
     ) x ON TRUE
     GROUP BY m.campaign_id`,
    [ids]
  ).catch(() => [])
  for (const r of rows) {
    const total = Number(r.total ?? 0)
    if (total > 0) out.set(r.campaign_id, Number(r.oos ?? 0) / total)
  }
  return out
}

/** Adds our margin view to the Recommendations tab rows. */
export async function withMarginImpact<T extends RecImpactInput & { campaignId?: string | null }>(rows: T[]): Promise<(T & { margin: MarginImpact; economics: Economics })[]> {
  if (!rows.length) return []
  const [econ, oos] = await Promise.all([
    loadEconomics().catch((): Economics => ({ aov: null, marginRate: null, basis: 'none' })),
    outOfStockShare(rows.map(r => r.campaignId ?? '').filter(Boolean)),
  ])
  return rows.map(r => ({ ...r, margin: marginImpact(r, econ, r.campaignId ? (oos.get(r.campaignId) ?? null) : null), economics: econ }))
}
