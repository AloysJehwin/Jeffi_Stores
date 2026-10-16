import { queryMany } from '@/lib/shared/db'
import { withChannelLock, type RunResult } from '@/lib/channels/sync-run'
import { istDate, replaceAll, replaceDateRange } from '@/lib/channels/report-store'
import {
  REPORT_QUERIES,
  fromMicros,
  gDate,
  getShippingSettings,
  listAccountIssues,
  listPrograms,
  listPromotions,
  listReturnPolicies,
  reportSearch,
} from './console-api'
import { buildOfferId } from './mapper'

// Daily refresh of the Merchant console: reports (performance, price competitiveness, price
// insights, best sellers matched to our catalogue) and account state (issues, programs, shipping,
// returns, promotions). Each step is independent: a report Google does not offer for this account
// fails alone and the console shows it as unavailable.

export const PERFORMANCE_DAYS = 30

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)

export function mapPerformance(rows: any[]): unknown[][] {
  const merged = new Map<string, unknown[]>()
  for (const r of rows) {
    const v = r?.productPerformanceView
    const date = gDate(v?.date)
    if (!v?.offerId || !date) continue
    const method = String(v.marketingMethod ?? 'UNKNOWN').slice(0, 16)
    const key = `${date}|${v.offerId}|${method}`
    const prev = merged.get(key)
    const row = [
      date,
      String(v.offerId),
      method,
      v.title ?? null,
      num(v.clicks) + num(prev?.[4]),
      num(v.impressions) + num(prev?.[5]),
      num(v.conversions) + num(prev?.[6]),
      (fromMicros(v.conversionValue) ?? 0) + num(prev?.[7]),
    ]
    merged.set(key, row)
  }
  return [...merged.values()]
}

export function mapPriceCompetitiveness(rows: any[]): unknown[][] {
  return rows
    .map(r => r?.priceCompetitivenessProductView)
    .filter(v => v?.offerId)
    .map(v => [String(v.offerId), v.title ?? null, v.brand ?? null, fromMicros(v.price), fromMicros(v.benchmarkPrice)])
}

export function mapPriceInsights(rows: any[]): unknown[][] {
  return rows
    .map(r => r?.priceInsightsProductView)
    .filter(v => v?.offerId)
    .map(v => [
      String(v.offerId),
      v.title ?? null,
      v.brand ?? null,
      fromMicros(v.price),
      fromMicros(v.suggestedPrice),
      v.predictedImpressionsChangeFraction ?? null,
      v.predictedClicksChangeFraction ?? null,
      v.predictedConversionsChangeFraction ?? null,
      v.effectiveness ?? null,
    ])
}

export interface CatalogGtin {
  productId: string
  offerId: string
  inStock: boolean
}

/** Best-seller rows matched to our catalogue by GTIN: in stock / out of stock when Google shows
 * the offer for us, not_listed when we carry it but it is not approved, not_carried otherwise. */
export function mapBestSellers(rows: any[], byGtin: Map<string, CatalogGtin>, listed: Set<string>): unknown[][] {
  const out: unknown[][] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const v = r?.bestSellersProductClusterView
    const date = gDate(v?.reportDate)
    if (!v || !date || v.rank == null) continue
    const key = `${date}|${v.reportCategoryId}|${v.rank}`
    if (seen.has(key)) continue
    seen.add(key)
    const gtins: string[] = (v.variantGtins ?? []).map(String)
    const match = gtins.map(g => byGtin.get(g.replace(/^0+/, ''))).find(Boolean) ?? null
    const status = !match ? 'not_carried' : !listed.has(match.offerId.toLowerCase()) ? 'not_listed' : match.inStock ? 'in_stock' : 'out_of_stock'
    out.push([
      date,
      String(v.reportCategoryId ?? ''),
      Number(v.rank),
      v.previousRank == null ? null : Number(v.previousRank),
      v.title ?? null,
      v.brand ?? null,
      v.categoryL1 ?? null,
      v.categoryL2 ?? null,
      v.categoryL3 ?? null,
      v.relativeDemand ?? null,
      v.inventoryStatus ?? null,
      v.brandInventoryStatus ?? null,
      gtins,
      match?.productId ?? null,
      status,
    ])
  }
  return out
}

/** Monday of the last complete week, in India time (best-seller weeks start on Monday). */
export function lastWeekStart(now = new Date()): string {
  const today = new Date(`${istDate(now)}T00:00:00Z`)
  const dow = (today.getUTCDay() + 6) % 7
  today.setUTCDate(today.getUTCDate() - dow - 7)
  return today.toISOString().slice(0, 10)
}

async function loadCatalogGtins(): Promise<Map<string, CatalogGtin>> {
  const rows = await queryMany<{ product_id: string; sku: string; gtin: string; stock_status: string | null }>(
    `SELECT p.id AS product_id, COALESCE(v.sku, p.sku) AS sku, COALESCE(NULLIF(v.gtin, ''), p.gtin) AS gtin,
            COALESCE(v.stock_status, p.stock_status) AS stock_status
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.is_active = TRUE AND COALESCE(NULLIF(v.gtin, ''), p.gtin) IS NOT NULL AND COALESCE(v.sku, p.sku) IS NOT NULL`
  )
  const map = new Map<string, CatalogGtin>()
  for (const r of rows) {
    map.set(String(r.gtin).replace(/\D/g, '').replace(/^0+/, ''), {
      productId: r.product_id,
      offerId: buildOfferId(r.sku),
      inStock: !/out/i.test(r.stock_status ?? ''),
    })
  }
  return map
}

const PERF_COLS = ['date', 'offer_id', 'marketing_method', 'title', 'clicks', 'impressions', 'conversions', 'conversion_value']
const PC_COLS = ['offer_id', 'title', 'brand', 'price', 'benchmark_price']
const PI_COLS = [
  'offer_id',
  'title',
  'brand',
  'price',
  'suggested_price',
  'predicted_impressions_change',
  'predicted_clicks_change',
  'predicted_conversions_change',
  'effectiveness',
]
const BS_COLS = [
  'report_date',
  'category_id',
  'rank',
  'previous_rank',
  'title',
  'brand',
  'category_l1',
  'category_l2',
  'category_l3',
  'relative_demand',
  'inventory_status',
  'brand_inventory_status',
  'gtins',
  'product_id',
  'catalog_status',
]

export async function refreshMerchantReports(now = new Date()): Promise<RunResult> {
  return withChannelLock('gmc', 'gmc_reports', 'reports', async ({ db, step }) => {
    await step('performance', async () => {
      const range = { from: istDate(now, PERFORMANCE_DAYS), to: istDate(now, 1) }
      const rows = mapPerformance(await reportSearch(REPORT_QUERIES.performance(range.from, range.to)))
      return replaceDateRange(db, 'gmc_product_performance', range, PERF_COLS, rows)
    })
    await step('price_competitiveness', async () =>
      replaceAll(db, 'gmc_price_competitiveness', PC_COLS, mapPriceCompetitiveness(await reportSearch(REPORT_QUERIES.priceCompetitiveness())))
    )
    await step('price_insights', async () =>
      replaceAll(db, 'gmc_price_insights', PI_COLS, mapPriceInsights(await reportSearch(REPORT_QUERIES.priceInsights())))
    )
    await step('best_sellers', async () => {
      let week = lastWeekStart(now)
      let rows = await reportSearch(REPORT_QUERIES.bestSellers(week), 5)
      if (!rows.length) {
        const prev = new Date(`${week}T00:00:00Z`)
        prev.setUTCDate(prev.getUTCDate() - 7)
        week = prev.toISOString().slice(0, 10)
        rows = await reportSearch(REPORT_QUERIES.bestSellers(week), 5)
      }
      const listed = new Set(
        (await queryMany<{ offer_id: string }>(`SELECT lower(offer_id) AS offer_id FROM merchant_gmc_status WHERE status IN ('approved', 'pending')`)).map(
          r => r.offer_id
        )
      )
      return replaceAll(db, 'gmc_best_sellers', BS_COLS, mapBestSellers(rows, await loadCatalogGtins(), listed))
    })
    await step('account_issues', async () => {
      const issues = await listAccountIssues()
      return replaceAll(
        db,
        'gmc_account_issues',
        ['name', 'title', 'severity', 'detail', 'documentation_uri', 'destinations'],
        issues.map(i => [
          String(i.name),
          String(i.title ?? 'Issue'),
          String(i.severity ?? 'SEVERITY_UNSPECIFIED').slice(0, 16),
          i.detail ?? null,
          i.documentationUri ?? null,
          JSON.stringify(i.impactedDestinations ?? []),
        ])
      )
    })
    await step('account_state', async () => {
      const [programs, shipping, returns, promotions] = await Promise.all([
        listPrograms().catch(() => []),
        getShippingSettings().catch(() => null),
        listReturnPolicies().catch(() => []),
        listPromotions().catch(() => []),
      ])
      await db.query(
        `INSERT INTO gmc_account_state (id, programs, shipping, return_policies, promotions, refreshed_at)
         VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET programs = EXCLUDED.programs, shipping = EXCLUDED.shipping,
           return_policies = EXCLUDED.return_policies, promotions = EXCLUDED.promotions, refreshed_at = now()`,
        [JSON.stringify(programs), shipping ? JSON.stringify(shipping) : null, JSON.stringify(returns), JSON.stringify(promotions)]
      )
      return promotions.length
    })
  })
}
