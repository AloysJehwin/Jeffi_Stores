import { queryMany, queryOne } from '@/lib/shared/db'
import { lastRuns } from '@/lib/channels/sync-run'
import { getGmcSummary } from './gmc-status'
import { getLastSyncStatus } from './sync'

// Read side of the Merchant console: one loader per tab over the local mirror.

export const MERCHANT_TABS = [
  'overview',
  'products',
  'issues',
  'performance',
  'competitiveness',
  'insights',
  'bestsellers',
  'promotions',
  'shipping',
  'account',
  'alerts',
  'changes',
  'runs',
] as const
export type MerchantTab = (typeof MERCHANT_TABS)[number]

export interface DateRange {
  from: string
  to: string
}

// Our catalogue keyed the way offers are built (lib/merchant/mapper.ts buildOfferId), lowercased.
const OFFERS_CTE = `offers AS (
  SELECT DISTINCT ON (lower(regexp_replace(COALESCE(v.sku, p.sku), '[^a-zA-Z0-9_:.-]', '_', 'g')))
    lower(regexp_replace(COALESCE(v.sku, p.sku), '[^a-zA-Z0-9_:.-]', '_', 'g')) AS offer_key,
    p.id AS product_id, v.id AS variant_id, p.name,
    COALESCE(v.price, p.base_price)::numeric AS price,
    COALESCE(v.price_ex_gst, p.price_ex_gst)::numeric AS price_ex_gst,
    COALESCE(v.cost_price, p.cost_price)::numeric AS cost,
    COALESCE(v.stock_status, p.stock_status) AS stock_status
  FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
  WHERE COALESCE(v.sku, p.sku) IS NOT NULL
)`

function previous(r: DateRange): DateRange {
  const from = new Date(`${r.from}T00:00:00Z`)
  const to = new Date(`${r.to}T00:00:00Z`)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  const pTo = new Date(from)
  pTo.setUTCDate(pTo.getUTCDate() - 1)
  const pFrom = new Date(pTo)
  pFrom.setUTCDate(pFrom.getUTCDate() - (days - 1))
  return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) }
}

interface PerfTotals {
  clicks: number
  impressions: number
  conversions: number
  value: number
}

async function totals(r: DateRange, method?: string): Promise<PerfTotals> {
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(conversions), 0) AS conversions, COALESCE(SUM(conversion_value), 0) AS value
     FROM gmc_product_performance WHERE date BETWEEN $1 AND $2 ${method ? 'AND marketing_method = $3' : ''}`,
    method ? [r.from, r.to, method] : [r.from, r.to]
  )
  return { clicks: Number(row?.clicks ?? 0), impressions: Number(row?.impressions ?? 0), conversions: Number(row?.conversions ?? 0), value: Number(row?.value ?? 0) }
}

export async function loadOverview(r: DateRange) {
  const p = previous(r)
  const [all, prev, organic, ads, daily, summary, accountIssues, lastPush, runs, bestsellers] = await Promise.all([
    totals(r),
    totals(p),
    totals(r, 'ORGANIC'),
    totals(r, 'ADS'),
    queryMany<any>(
      `SELECT date::text AS date,
              SUM(clicks) FILTER (WHERE marketing_method = 'ORGANIC') AS organic_clicks,
              SUM(clicks) FILTER (WHERE marketing_method = 'ADS') AS ads_clicks,
              SUM(impressions) AS impressions
       FROM gmc_product_performance WHERE date BETWEEN $1 AND $2 GROUP BY date ORDER BY date`,
      [r.from, r.to]
    ),
    getGmcSummary().catch(() => null),
    queryOne<{ n: string }>(`SELECT count(*) AS n FROM gmc_account_issues WHERE severity IN ('CRITICAL', 'ERROR')`).catch(() => null),
    getLastSyncStatus().catch(() => null),
    lastRuns('gmc'),
    queryMany<{ catalog_status: string; n: string }>(`SELECT catalog_status, count(*) AS n FROM gmc_best_sellers GROUP BY 1`).catch(() => []),
  ])
  return {
    range: r,
    previousRange: p,
    totals: all,
    previous: prev,
    organic,
    ads,
    daily: daily.map(d => ({ date: d.date, organic: Number(d.organic_clicks ?? 0), ads: Number(d.ads_clicks ?? 0), impressions: Number(d.impressions ?? 0) })),
    summary,
    accountIssues: Number(accountIssues?.n ?? 0),
    lastPush,
    lastRuns: runs,
    bestsellers: Object.fromEntries(bestsellers.map(b => [b.catalog_status, Number(b.n)])),
  }
}

export async function loadPerformance(r: DateRange) {
  const rows = await queryMany<any>(
    `WITH ${OFFERS_CTE}
     SELECT g.offer_id, MAX(g.title) AS title, o.product_id,
       SUM(g.clicks) FILTER (WHERE g.marketing_method = 'ORGANIC') AS organic_clicks,
       SUM(g.clicks) FILTER (WHERE g.marketing_method = 'ADS') AS ads_clicks,
       SUM(g.impressions) AS impressions, SUM(g.clicks) AS clicks, SUM(g.conversions) AS conversions, SUM(g.conversion_value) AS value
     FROM gmc_product_performance g LEFT JOIN offers o ON o.offer_key = lower(g.offer_id)
     WHERE g.date BETWEEN $1 AND $2
     GROUP BY g.offer_id, o.product_id ORDER BY clicks DESC LIMIT 1000`,
    [r.from, r.to]
  )
  return {
    rows: rows.map(x => ({
      offerId: x.offer_id,
      title: x.title,
      productId: x.product_id,
      organicClicks: Number(x.organic_clicks ?? 0),
      adsClicks: Number(x.ads_clicks ?? 0),
      clicks: Number(x.clicks ?? 0),
      impressions: Number(x.impressions ?? 0),
      conversions: Number(x.conversions ?? 0),
      value: Number(x.value ?? 0),
    })),
  }
}

/** Item issues across all products, grouped by Google's issue code, with affected offers. */
export async function loadIssues() {
  const rows = await queryMany<any>(
    `SELECT i->>'code' AS code, MAX(i->>'description') AS description, MAX(i->>'detail') AS detail,
            MAX(i->>'servability') AS servability, MAX(i->>'documentation') AS documentation,
            count(DISTINCT s.offer_id) AS products, (array_agg(DISTINCT s.offer_id))[1:20] AS offers
     FROM merchant_gmc_status s, jsonb_array_elements(COALESCE(s.item_issues, '[]'::jsonb)) i
     GROUP BY 1 ORDER BY products DESC LIMIT 200`
  ).catch(() => [])
  return {
    groups: rows.map(r => ({
      code: r.code,
      description: r.description,
      detail: r.detail,
      servability: r.servability,
      documentation: r.documentation,
      products: Number(r.products),
      offers: r.offers ?? [],
    })),
  }
}

export async function loadAccount() {
  const [issues, state] = await Promise.all([
    queryMany<any>(`SELECT name, title, severity, detail, documentation_uri, destinations, refreshed_at FROM gmc_account_issues ORDER BY severity, title`).catch(() => []),
    queryOne<any>(`SELECT programs, refreshed_at FROM gmc_account_state WHERE id = 1`).catch(() => null),
  ])
  return { issues, programs: state?.programs ?? [], refreshedAt: state?.refreshed_at ?? null }
}

export async function loadCompetitiveness(days = 30) {
  const rows = await queryMany<any>(
    `WITH ${OFFERS_CTE}
     SELECT c.offer_id, c.title, c.brand, c.price, c.benchmark_price, o.product_id, o.cost, o.price_ex_gst, o.price AS our_price,
       (SELECT COALESCE(SUM(clicks), 0) FROM gmc_product_performance p WHERE p.offer_id = c.offer_id AND p.date >= current_date - $1::int) AS clicks
     FROM gmc_price_competitiveness c LEFT JOIN offers o ON o.offer_key = lower(c.offer_id)
     ORDER BY clicks DESC NULLS LAST, c.offer_id LIMIT 2000`,
    [days]
  ).catch(() => [])
  return {
    rows: rows.map(r => {
      const price = r.price == null ? null : Number(r.price)
      const bench = r.benchmark_price == null ? null : Number(r.benchmark_price)
      return {
        offerId: r.offer_id,
        title: r.title,
        brand: r.brand,
        productId: r.product_id,
        price,
        benchmark: bench,
        gap: price != null && bench ? (price - bench) / bench : null,
        clicks: Number(r.clicks ?? 0),
      }
    }),
  }
}

/** Margin per unit at a price (tax-inclusive), from our cost and the product's GST ratio. */
export function marginAt(price: number | null, ourPrice: number | null, priceExGst: number | null, cost: number | null): number | null {
  if (price == null || cost == null || !ourPrice) return null
  const exRatio = priceExGst && ourPrice ? priceExGst / ourPrice : 1
  return Math.round((price * exRatio - cost) * 100) / 100
}

export async function loadInsights() {
  const rows = await queryMany<any>(
    `WITH ${OFFERS_CTE}
     SELECT i.*, o.product_id, o.variant_id, o.cost, o.price_ex_gst, o.price AS our_price
     FROM gmc_price_insights i LEFT JOIN offers o ON o.offer_key = lower(i.offer_id)
     ORDER BY i.predicted_conversions_change DESC NULLS LAST LIMIT 2000`
  ).catch(() => [])
  return {
    rows: rows.map(r => {
      const n = (v: unknown) => (v == null ? null : Number(v))
      return {
        offerId: r.offer_id,
        title: r.title,
        brand: r.brand,
        productId: r.product_id,
        variantId: r.variant_id,
        price: n(r.price),
        suggested: n(r.suggested_price),
        impressionsChange: n(r.predicted_impressions_change),
        clicksChange: n(r.predicted_clicks_change),
        conversionsChange: n(r.predicted_conversions_change),
        effectiveness: r.effectiveness,
        marginNow: marginAt(n(r.price), n(r.our_price), n(r.price_ex_gst), n(r.cost)),
        marginSuggested: marginAt(n(r.suggested_price), n(r.our_price), n(r.price_ex_gst), n(r.cost)),
      }
    }),
  }
}

export async function loadBestSellers() {
  const rows = await queryMany<any>(
    `SELECT b.*, p.name AS product_name FROM gmc_best_sellers b LEFT JOIN products p ON p.id = b.product_id
     ORDER BY CASE b.catalog_status WHEN 'not_listed' THEN 0 WHEN 'out_of_stock' THEN 1 WHEN 'in_stock' THEN 2 ELSE 3 END, b.rank LIMIT 2000`
  ).catch(() => [])
  return {
    reportDate: rows[0]?.report_date ?? null,
    rows: rows.map(r => ({
      key: `${r.category_id}:${r.rank}`,
      rank: r.rank,
      previousRank: r.previous_rank,
      title: r.title,
      brand: r.brand,
      category: [r.category_l1, r.category_l2, r.category_l3].filter(Boolean).join(' > '),
      demand: r.relative_demand,
      status: r.catalog_status,
      productId: r.product_id,
      productName: r.product_name,
    })),
  }
}

export async function loadAccountState() {
  const s = await queryOne<any>(`SELECT shipping, return_policies, promotions, programs, refreshed_at FROM gmc_account_state WHERE id = 1`).catch(() => null)
  return {
    shipping: s?.shipping ?? null,
    returnPolicies: s?.return_policies ?? [],
    promotions: s?.promotions ?? [],
    programs: s?.programs ?? [],
    refreshedAt: s?.refreshed_at ?? null,
  }
}

export async function loadMerchantTab(tab: MerchantTab, r: DateRange) {
  switch (tab) {
    case 'overview':
      return loadOverview(r)
    case 'performance':
      return loadPerformance(r)
    case 'issues':
      return loadIssues()
    case 'account':
      return loadAccount()
    case 'competitiveness':
      return loadCompetitiveness()
    case 'insights':
      return loadInsights()
    case 'bestsellers':
      return loadBestSellers()
    case 'promotions':
    case 'shipping':
      return loadAccountState()
    default:
      return {}
  }
}
