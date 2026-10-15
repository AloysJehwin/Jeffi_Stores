import { queryMany, queryOne } from '@/lib/shared/db'
import type { DateRange } from './queries'
import { googleAdsOrderStats, computeReturnMetrics, type AdsOrderStats, type ReturnMetrics } from './attribution'

// Read-side loaders for the Google Ads console. Everything reads the local ads_* mirror; money is
// returned in account currency units (micros / 1e6).

export type AdsTab =
  | 'overview'
  | 'campaigns'
  | 'adgroups'
  | 'keywords'
  | 'products'
  | 'locations'
  | 'recommendations'
  | 'changes'
  | 'sync'

export const ADS_TABS: AdsTab[] = [
  'overview',
  'campaigns',
  'adgroups',
  'keywords',
  'products',
  'locations',
  'recommendations',
  'changes',
  'sync',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 400

/** Validate/normalise a requested range; defaults to the last 30 days ending today. */
export function parseRange(from: string | null | undefined, to: string | null | undefined, today = new Date()): DateRange {
  const t = today.toISOString().slice(0, 10)
  let end = to && DATE_RE.test(to) ? to : t
  let start = from && DATE_RE.test(from) ? from : ''
  if (!start) {
    const d = new Date(`${end}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 29)
    start = d.toISOString().slice(0, 10)
  }
  if (start > end) [start, end] = [end, start]
  const span = (Date.parse(end) - Date.parse(start)) / 86_400_000
  if (span > MAX_RANGE_DAYS) {
    const d = new Date(`${end}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - MAX_RANGE_DAYS)
    start = d.toISOString().slice(0, 10)
  }
  return { from: start, to: end }
}

/** The equally long period right before `r` (for period-over-period compare). */
export function previousRange(r: DateRange): DateRange {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1
  const end = new Date(`${r.from}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export interface Kpis {
  cost: number
  impressions: number
  clicks: number
  conversions: number
  conversionsValue: number
  ctr: number | null
  avgCpc: number | null
  roas: number | null
  costPerConversion: number | null
}

const n = (v: unknown) => Number(v ?? 0) || 0

export function kpisFrom(raw: { cost_micros?: unknown; impressions?: unknown; clicks?: unknown; conversions?: unknown; conversions_value?: unknown }): Kpis {
  const cost = n(raw.cost_micros) / 1_000_000
  const impressions = n(raw.impressions)
  const clicks = n(raw.clicks)
  const conversions = n(raw.conversions)
  const conversionsValue = n(raw.conversions_value)
  return {
    cost,
    impressions,
    clicks,
    conversions,
    conversionsValue,
    ctr: impressions > 0 ? clicks / impressions : null,
    avgCpc: clicks > 0 ? cost / clicks : null,
    roas: cost > 0 ? conversionsValue / cost : null,
    costPerConversion: conversions > 0 ? cost / conversions : null,
  }
}

const SUM_METRICS = `COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks,
  COALESCE(SUM(cost_micros),0) AS cost_micros, COALESCE(SUM(conversions),0) AS conversions,
  COALESCE(SUM(conversions_value),0) AS conversions_value`

export interface AdsAccountRow {
  customer_id: string
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
  manager_id: string | null
  test_account: boolean
  status: string | null
  optimization_score: string | null
  budget_status: string | null
  budget_limit_micros: string | null
  budget_served_micros: string | null
  budget_end: string | null
  last_sync_at: string | null
  last_full_sync_at: string | null
}

export async function getAdsAccount(): Promise<AdsAccountRow | null> {
  return queryOne<AdsAccountRow>(`SELECT * FROM ads_account WHERE id = 1`).catch(() => null)
}

const POLICY_ISSUE = `approval_status IN ('DISAPPROVED', 'APPROVED_LIMITED', 'AREA_OF_INTEREST_ONLY')`

export interface OverviewData {
  account: AdsAccountRow | null
  range: DateRange
  previous: DateRange
  kpis: Kpis
  previousKpis: Kpis
  trend: { label: string; cost: number; clicks: number; conversions: number; conversionsValue: number; impressions: number }[]
  byNetwork: { network: string; cost: number; clicks: number }[]
  byDevice: { device: string; cost: number; clicks: number }[]
  policyIssues: number
  disapproved: number
  lastSync: { status: string; mode: string; finished_at: string | null; started_at: string } | null
  orders: AdsOrderStats
  returns: ReturnMetrics
}

export async function loadOverview(range: DateRange): Promise<OverviewData> {
  const previous = previousRange(range)
  const account = await getAdsAccount()
  const tz = account?.time_zone || 'Asia/Kolkata'
  const [cur, prev, trend, byNetwork, byDevice, policy, lastSync, orders] = await Promise.all([
    queryOne(`SELECT ${SUM_METRICS} FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2`, [range.from, range.to]),
    queryOne(`SELECT ${SUM_METRICS} FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2`, [previous.from, previous.to]),
    queryMany(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS label, ${SUM_METRICS}
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN ads_daily_metrics m ON m.date = d::date AND m.ad_group_id = 0
       GROUP BY d ORDER BY d`,
      [range.from, range.to]
    ),
    queryMany(
      `SELECT network, COALESCE(SUM(cost_micros),0) AS cost_micros, COALESCE(SUM(clicks),0) AS clicks
       FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2 GROUP BY network ORDER BY 2 DESC`,
      [range.from, range.to]
    ),
    queryMany(
      `SELECT device, COALESCE(SUM(cost_micros),0) AS cost_micros, COALESCE(SUM(clicks),0) AS clicks
       FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2 GROUP BY device ORDER BY 2 DESC`,
      [range.from, range.to]
    ),
    queryOne<{ issues: number; disapproved: number }>(
      `SELECT COUNT(*) FILTER (WHERE ${POLICY_ISSUE})::int AS issues,
              COUNT(*) FILTER (WHERE approval_status = 'DISAPPROVED')::int AS disapproved
       FROM ads_ads WHERE status = 'ENABLED'`
    ),
    queryOne(`SELECT status, mode, started_at, finished_at FROM ads_sync_log ORDER BY started_at DESC LIMIT 1`),
    googleAdsOrderStats(range, tz),
  ])
  const kpis = kpisFrom(cur ?? {})
  return {
    account,
    range,
    previous,
    kpis,
    previousKpis: kpisFrom(prev ?? {}),
    trend: trend.map((t: any) => ({
      label: t.label,
      cost: n(t.cost_micros) / 1e6,
      clicks: n(t.clicks),
      impressions: n(t.impressions),
      conversions: n(t.conversions),
      conversionsValue: n(t.conversions_value),
    })),
    byNetwork: byNetwork.map((r: any) => ({ network: r.network, cost: n(r.cost_micros) / 1e6, clicks: n(r.clicks) })),
    byDevice: byDevice.map((r: any) => ({ device: r.device, cost: n(r.cost_micros) / 1e6, clicks: n(r.clicks) })),
    policyIssues: policy?.issues ?? 0,
    disapproved: policy?.disapproved ?? 0,
    lastSync: (lastSync as any) ?? null,
    orders,
    returns: computeReturnMetrics(kpis.cost, orders),
  }
}

export async function loadCampaigns(range: DateRange) {
  const rows = await queryMany(
    `SELECT c.*, ${SUM_METRICS}
     FROM ads_campaigns c
     LEFT JOIN ads_daily_metrics m ON m.campaign_id = c.campaign_id AND m.ad_group_id = 0 AND m.date BETWEEN $1 AND $2
     GROUP BY c.campaign_id
     ORDER BY COALESCE(SUM(m.cost_micros),0) DESC, c.name`,
    [range.from, range.to]
  )
  return rows.map((r: any) => ({
    campaignId: String(r.campaign_id),
    name: r.name,
    status: r.status,
    servingStatus: r.serving_status,
    primaryStatus: r.primary_status,
    channelType: r.channel_type,
    biddingStrategy: r.bidding_strategy_type,
    budget: r.budget_amount_micros == null ? null : n(r.budget_amount_micros) / 1e6,
    budgetPeriod: r.budget_period,
    ...kpisFrom(r),
  }))
}

export async function loadAdGroups(range: DateRange) {
  const [groups, ads] = await Promise.all([
    queryMany(
      `SELECT g.ad_group_id, g.name, g.status, g.type, g.cpc_bid_micros, c.name AS campaign_name, ${SUM_METRICS}
       FROM ads_ad_groups g
       LEFT JOIN ads_campaigns c ON c.campaign_id = g.campaign_id
       LEFT JOIN ads_daily_metrics m ON m.ad_group_id = g.ad_group_id AND m.date BETWEEN $1 AND $2
       GROUP BY g.ad_group_id, c.name
       ORDER BY COALESCE(SUM(m.cost_micros),0) DESC, g.name
       LIMIT 500`,
      [range.from, range.to]
    ),
    queryMany(
      `SELECT a.*, g.name AS ad_group_name, c.name AS campaign_name
       FROM ads_ads a
       LEFT JOIN ads_ad_groups g ON g.ad_group_id = a.ad_group_id
       LEFT JOIN ads_campaigns c ON c.campaign_id = a.campaign_id
       ORDER BY (a.approval_status = 'DISAPPROVED') DESC, (a.${POLICY_ISSUE}) DESC, a.cost_micros DESC
       LIMIT 500`
    ),
  ])
  return {
    adGroups: groups.map((r: any) => ({
      adGroupId: String(r.ad_group_id),
      name: r.name,
      campaignName: r.campaign_name,
      status: r.status,
      type: r.type,
      cpcBid: r.cpc_bid_micros == null ? null : n(r.cpc_bid_micros) / 1e6,
      ...kpisFrom(r),
    })),
    ads: ads.map((r: any) => ({
      adId: String(r.ad_id),
      name: r.name || (Array.isArray(r.headlines) ? r.headlines[0] : null),
      type: r.type,
      status: r.status,
      approvalStatus: r.approval_status,
      reviewStatus: r.review_status,
      policyTopics: (r.policy_topics ?? []) as { topic: string | null; type: string | null }[],
      finalUrl: Array.isArray(r.final_urls) ? r.final_urls[0] ?? null : null,
      adGroupName: r.ad_group_name,
      campaignName: r.campaign_name,
      ...kpisFrom({ ...r, conversions_value: 0 }),
    })),
  }
}

export async function loadKeywords(range: DateRange) {
  const [keywords, terms] = await Promise.all([
    queryMany(
      `SELECT k.*, g.name AS ad_group_name FROM ads_keywords k
       LEFT JOIN ads_ad_groups g ON g.ad_group_id = k.ad_group_id
       ORDER BY k.negative, k.cost_micros DESC LIMIT 500`
    ),
    queryMany(
      `WITH t AS (
         SELECT search_term, MAX(keyword_text) AS keyword_text, MAX(status) AS status, ${SUM_METRICS}
         FROM ads_search_terms WHERE date BETWEEN $1 AND $2
         GROUP BY search_term ORDER BY SUM(cost_micros) DESC, SUM(clicks) DESC LIMIT 300
       ), tok AS (
         SELECT t.search_term, ARRAY(SELECT w FROM unnest(regexp_split_to_array(lower(t.search_term), '[^a-z0-9]+')) w
                                     WHERE length(w) >= 3) AS words
         FROM t
       )
       SELECT t.*,
         (
           EXISTS (SELECT 1 FROM products p WHERE p.is_active IS NOT FALSE AND p.name ILIKE '%' || t.search_term || '%')
           OR EXISTS (SELECT 1 FROM categories c WHERE c.is_active IS NOT FALSE
                        AND (c.name ILIKE '%' || t.search_term || '%' OR t.search_term ILIKE '%' || c.name || '%'))
           OR EXISTS (SELECT 1 FROM search_logs s WHERE lower(s.query) = lower(t.search_term) AND s.results_count > 0)
           OR (cardinality(tok.words) > 0 AND EXISTS (
                SELECT 1 FROM products p WHERE p.is_active IS NOT FALSE
                  AND NOT EXISTS (SELECT 1 FROM unnest(tok.words) w WHERE p.name NOT ILIKE '%' || w || '%')))
         ) AS in_catalogue
       FROM t JOIN tok ON tok.search_term = t.search_term
       ORDER BY t.cost_micros DESC, t.clicks DESC`,
      [range.from, range.to]
    ),
  ])
  return {
    keywords: keywords.map((r: any) => ({
      criterionId: String(r.criterion_id),
      text: r.text,
      matchType: r.match_type,
      status: r.status,
      negative: !!r.negative,
      qualityScore: r.quality_score,
      adGroupName: r.ad_group_name,
      ...kpisFrom(r),
    })),
    searchTerms: terms.map((r: any) => ({
      term: r.search_term,
      keyword: r.keyword_text,
      status: r.status,
      inCatalogue: !!r.in_catalogue,
      ...kpisFrom(r),
    })),
  }
}

export interface ProductRow extends Kpis {
  itemId: string
  title: string | null
  sku: string | null
  productName: string | null
  stock: number | null
  stockStatus: string | null
  price: number | null
  costPrice: number | null
  unitMargin: number | null
  flags: ('out_of_stock' | 'negative_margin' | 'unprofitable' | 'unmatched')[]
}

/** Item flags: spend on stock we can't sell, products sold at a loss, or ads that cost more than they earned. */
export function productFlags(p: Pick<ProductRow, 'sku' | 'stock' | 'stockStatus' | 'unitMargin' | 'cost' | 'conversions'>): ProductRow['flags'] {
  const flags: ProductRow['flags'] = []
  if (!p.sku) return ['unmatched']
  // stock_status is what the storefront and the Merchant feed sell on; quantity only when it is unset.
  const out = p.stockStatus ? p.stockStatus === 'Out of Stock' : p.stock != null && p.stock <= 0
  if (p.cost > 0 && out) flags.push('out_of_stock')
  if (p.unitMargin != null && p.unitMargin <= 0 && p.cost > 0) flags.push('negative_margin')
  else if (p.unitMargin != null && p.cost > 0 && p.cost > p.unitMargin * p.conversions) flags.push('unprofitable')
  return flags
}

const OFFER_ID_SQL = (col: string) => `lower(regexp_replace(${col}, '[^a-zA-Z0-9_:.-]', '_', 'g'))`

export async function loadProducts(range: DateRange) {
  const items = await queryMany(
    `WITH m AS (
       SELECT item_id, MAX(product_title) AS title, ${SUM_METRICS}
       FROM ads_product_metrics WHERE date BETWEEN $1 AND $2 GROUP BY item_id
     )
     SELECT m.*, x.sku, x.product_name, x.stock, x.stock_status, x.price, x.cost_price
     FROM m
     LEFT JOIN LATERAL (
       SELECT v.sku, p.name AS product_name, v.inventory_quantity AS stock, v.stock_status,
              COALESCE(v.price_ex_gst, v.price, p.price_ex_gst, p.base_price) AS price,
              COALESCE(NULLIF(v.cost_price, 0), p.cost_price) AS cost_price
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE ${OFFER_ID_SQL('v.sku')} = m.item_id
       UNION ALL
       SELECT p.sku, p.name, p.inventory_quantity, p.stock_status, COALESCE(p.price_ex_gst, p.base_price), p.cost_price
       FROM products p WHERE ${OFFER_ID_SQL('p.sku')} = m.item_id
       LIMIT 1
     ) x ON TRUE
     ORDER BY m.cost_micros DESC
     LIMIT 500`,
    [range.from, range.to]
  )
  const rows: ProductRow[] = items.map((r: any) => {
    const k = kpisFrom(r)
    const price = r.price == null ? null : n(r.price)
    const costPrice = r.cost_price == null || n(r.cost_price) <= 0 ? null : n(r.cost_price)
    const base = {
      itemId: r.item_id,
      title: r.title,
      sku: r.sku ?? null,
      productName: r.product_name ?? null,
      stock: r.stock == null ? null : n(r.stock),
      stockStatus: r.stock_status ?? null,
      price,
      costPrice,
      unitMargin: price != null && costPrice != null ? Math.round((price - costPrice) * 100) / 100 : null,
      ...k,
    }
    return { ...base, flags: productFlags(base) }
  })

  // Our best sellers in the period that Google showed zero times.
  const bestsellers = await queryMany(
    `WITH sold AS (
       SELECT COALESCE(v.sku, p.sku) AS sku, MAX(p.name) AS name, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
       WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
         AND o.created_at::date BETWEEN $1::date AND $2::date
       GROUP BY 1 ORDER BY SUM(oi.quantity) DESC LIMIT 50
     )
     SELECT s.* FROM sold s
     WHERE NOT EXISTS (
       SELECT 1 FROM ads_product_metrics m
       WHERE m.item_id = ${OFFER_ID_SQL('s.sku')} AND m.date BETWEEN $1 AND $2 AND m.impressions > 0
     )
     ORDER BY s.units DESC LIMIT 20`,
    [range.from, range.to]
  ).catch(() => [])

  return {
    items: rows,
    bestsellersWithoutImpressions: bestsellers.map((b: any) => ({
      sku: b.sku,
      name: b.name,
      units: n(b.units),
      revenue: n(b.revenue),
    })),
  }
}

export async function loadLocations(range: DateRange) {
  const rows = await queryMany(
    `SELECT location, MAX(location_name) AS location_name, ${SUM_METRICS}
     FROM ads_geo_metrics WHERE date BETWEEN $1 AND $2
     GROUP BY location ORDER BY SUM(cost_micros) DESC LIMIT 200`,
    [range.from, range.to]
  )
  return rows.map((r: any) => ({ location: r.location_name || r.location, ...kpisFrom(r) }))
}

export async function loadRecommendations() {
  const rows = await queryMany(
    `SELECT r.resource_name, r.type, r.impact, r.dismissed, c.name AS campaign_name
     FROM ads_recommendations r LEFT JOIN ads_campaigns c ON c.campaign_id = r.campaign_id
     WHERE NOT r.dismissed ORDER BY r.type`
  )
  return rows.map((r: any) => {
    const base = r.impact?.baseMetrics ?? {}
    const pot = r.impact?.potentialMetrics ?? {}
    return {
      id: r.resource_name,
      type: r.type,
      campaignName: r.campaign_name,
      extraClicks: pot.clicks != null ? n(pot.clicks) - n(base.clicks) : null,
      extraConversions: pot.conversions != null ? n(pot.conversions) - n(base.conversions) : null,
      extraCost: pot.costMicros != null ? (n(pot.costMicros) - n(base.costMicros)) / 1e6 : null,
    }
  })
}

export async function loadChanges() {
  return queryMany(
    `SELECT to_char(e.change_date_time, 'YYYY-MM-DD HH24:MI') AS change_date_time, e.resource_type, e.operation, e.client_type, e.user_email, e.changed_fields,
            c.name AS campaign_name
     FROM ads_change_events e LEFT JOIN ads_campaigns c ON c.campaign_id = e.campaign_id
     ORDER BY e.change_date_time DESC NULLS LAST LIMIT 300`
  )
}

export async function loadSyncLog() {
  return queryMany(
    `SELECT id, mode, status, to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to,
            rows, errors, started_at, finished_at
     FROM ads_sync_log ORDER BY started_at DESC LIMIT 50`
  )
}

export async function loadTab(tab: AdsTab, range: DateRange): Promise<unknown> {
  switch (tab) {
    case 'overview':
      return loadOverview(range)
    case 'campaigns':
      return { campaigns: await loadCampaigns(range) }
    case 'adgroups':
      return loadAdGroups(range)
    case 'keywords':
      return loadKeywords(range)
    case 'products':
      return loadProducts(range)
    case 'locations':
      return { locations: await loadLocations(range) }
    case 'recommendations':
      return { recommendations: await loadRecommendations() }
    case 'changes':
      return { changes: await loadChanges() }
    case 'sync':
      return { log: await loadSyncLog() }
  }
}
