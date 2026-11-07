import { query, queryMany, queryOne } from '@/lib/shared/db'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { kpis, type Range } from '@/lib/amazon-ads/console'
import { ADS_MARKET, type AdsChannel, type AdsMarket } from './columns'
import { matchAdProducts, matchFor } from './match'
import { CAMPAIGN_NAMES, adsRuleSet } from './alerts'
import { listImports } from './import'

// Read side of the Myntra Ads / AJIO Ads consoles. KPI maths is Amazon Ads' kpis(). Campaign
// figures come from the campaign report; on days with only a product report imported, its rows
// stand in so a store that imports one kind still sees totals (never both, so nothing is counted twice).

export const MADS_TABS = ['overview', 'campaigns', 'products', 'imports'] as const
export type MadsTab = (typeof MADS_TABS)[number]

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

function previous(r: Range): Range {
  const from = new Date(`${r.from}T00:00:00Z`)
  const to = new Date(`${r.to}T00:00:00Z`)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  const pTo = new Date(from.getTime() - 86_400_000)
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86_400_000)
  return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) }
}

const SUMS = `COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(spend),0) AS cost,
  COALESCE(SUM(sales),0) AS sales, COALESCE(SUM(orders),0) AS orders, COALESCE(SUM(units),0) AS units`

const SOURCE = `
  WITH d AS (SELECT date, campaign_key, campaign_name, ad_group, impressions, clicks, spend, orders, units, sales
               FROM marketplace_ad_daily WHERE channel = $1 AND date BETWEEN $2 AND $3),
  ${CAMPAIGN_NAMES},
  src AS (
    SELECT * FROM d
    UNION ALL
    SELECT p.date, COALESCE(nm.campaign_key, p.campaign_key), p.campaign_name, '' AS ad_group, p.impressions, p.clicks, p.spend, p.orders, p.units, p.sales
      FROM marketplace_ad_products p LEFT JOIN nm ON nm.campaign_name = p.campaign_name AND p.campaign_key = p.campaign_name
     WHERE p.channel = $1 AND p.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM d WHERE d.date = p.date)
  )`

const withUnits = (r: any) => ({ ...kpis(r), units: n(r.units) })

async function totals(m: AdsMarket, r: Range) {
  return withUnits((await queryOne<any>(`${SOURCE} SELECT ${SUMS} FROM src`, [m, r.from, r.to])) ?? {})
}

const lastCheck = new Map<string, number>()

/** Alerts on console open, at most every 30 minutes per store and channel (imports run them too). */
async function maybeRunAlerts(channel: AdsChannel): Promise<void> {
  const tenant = (await resolveTenant().catch(() => null))?.slug ?? ''
  const key = `${tenant}:${channel}`
  if (Date.now() - (lastCheck.get(key) ?? 0) < 30 * 60_000) return
  lastCheck.set(key, Date.now())
  await runChannelAlerts(adsRuleSet(channel))
}

export async function loadOverview(channel: AdsChannel, r: Range) {
  const m = ADS_MARKET[channel]
  const [cur, prev, daily, last, coverage] = await Promise.all([
    totals(m, r),
    totals(m, previous(r)),
    queryMany<any>(`${SOURCE} SELECT date::text AS date, ${SUMS} FROM src GROUP BY date ORDER BY date`, [m, r.from, r.to]),
    queryOne<any>(`SELECT file_name, kind, date_from::text, date_to::text, imported_at, imported_by_email FROM marketplace_ad_imports WHERE channel = $1 ORDER BY imported_at DESC LIMIT 1`, [m]),
    queryOne<any>(
      `SELECT min(date)::text AS from, max(date)::text AS to FROM (
         SELECT date FROM marketplace_ad_daily WHERE channel = $1 UNION ALL SELECT date FROM marketplace_ad_products WHERE channel = $1) x`,
      [m]
    ),
  ])
  maybeRunAlerts(channel).catch(() => {})
  return {
    kpis: cur,
    previous: prev,
    daily: daily.map(d => ({ date: d.date, ...withUnits(d) })),
    lastImport: last,
    coverage: coverage?.from ? { from: coverage.from, to: coverage.to } : null,
  }
}

export async function loadCampaigns(channel: AdsChannel, r: Range) {
  const rows = await queryMany<any>(
    `${SOURCE}
     SELECT campaign_key, max(campaign_name) AS name, count(DISTINCT NULLIF(ad_group, '')) AS ad_groups, count(DISTINCT date) AS days, ${SUMS}
       FROM src GROUP BY campaign_key ORDER BY SUM(spend) DESC LIMIT 2000`,
    [ADS_MARKET[channel], r.from, r.to]
  )
  return {
    rows: rows.map(c => ({
      campaignKey: c.campaign_key,
      name: c.name || c.campaign_key || '(no campaign)',
      adGroups: n(c.ad_groups),
      days: n(c.days),
      ...withUnits(c),
    })),
  }
}

/** Products with profit after ads: ad sales ex-GST, less catalogue cost per unit, less spend.
 * Matching runs again on load so a listing mapped after the import still counts. */
export async function loadProducts(channel: AdsChannel, r: Range) {
  const m = ADS_MARKET[channel]
  const rows = await queryMany<any>(
    `SELECT product_key, max(sku) AS sku, max(style_id) AS style_id, max(product_name) AS product_name,
            (array_agg(product_id) FILTER (WHERE product_id IS NOT NULL))[1] AS product_id,
            (array_agg(variant_id) FILTER (WHERE product_id IS NOT NULL))[1] AS variant_id,
            (array_agg(sub_variant_id) FILTER (WHERE product_id IS NOT NULL))[1] AS sub_variant_id, ${SUMS}
       FROM marketplace_ad_products WHERE channel = $1 AND date BETWEEN $2 AND $3
      GROUP BY product_key ORDER BY SUM(spend) DESC LIMIT 2000`,
    [m, r.from, r.to]
  )
  const matches = await matchAdProducts({ query } as any, m, rows.map(p => ({ sku: p.sku, styleId: p.style_id }))).catch(() => new Map())
  const units = rows.map(p => {
    const hit = matchFor(matches, p.sku, p.style_id)
    return hit ?? (p.product_id ? { product_id: p.product_id, variant_id: p.variant_id, sub_variant_id: p.sub_variant_id, name: null } : null)
  })
  const ids = units.filter((u): u is NonNullable<typeof u> => !!u)
  const cat = ids.length
    ? await queryMany<any>(
        `SELECT u.pid::text AS product_id, u.vid::text AS variant_id, u.svid::text AS sub_variant_id, p.name,
                COALESCE(NULLIF(v.cost_price, 0), NULLIF(p.cost_price, 0)) AS cost,
                COALESCE(sv.stock_status, v.stock_status, p.stock_status) AS stock_status,
                COALESCE(sv.price, v.price, p.base_price) AS price,
                COALESCE(sv.price_ex_gst, v.price_ex_gst, p.price_ex_gst) AS price_ex_gst
           FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS u(pid, vid, svid)
           JOIN products p ON p.id = u.pid
           LEFT JOIN product_variants v ON v.id = u.vid
           LEFT JOIN product_sub_variants sv ON sv.id = u.svid`,
        [ids.map(u => u.product_id), ids.map(u => u.variant_id), ids.map(u => u.sub_variant_id)]
      ).catch(() => [])
    : []
  const key = (pid: string, vid: string | null, svid: string | null) => `${pid}|${vid ?? ''}|${svid ?? ''}`
  const byUnit = new Map(cat.map(c => [key(c.product_id, c.variant_id, c.sub_variant_id), c]))
  return {
    rows: rows.map((p, i) => {
      const k = withUnits(p)
      const u = units[i]
      const c = u ? byUnit.get(key(u.product_id, u.variant_id, u.sub_variant_id)) : null
      const sold = k.units || k.orders
      const ex = c?.price && c?.price_ex_gst ? n(c.price_ex_gst) / n(c.price) : 1
      const grossProfit = c?.cost == null ? null : k.sales * ex - sold * n(c.cost)
      return {
        productKey: p.product_key,
        sku: p.sku,
        styleId: p.style_id,
        name: c?.name ?? p.product_name ?? null,
        reportName: p.product_name,
        matched: !!c,
        productId: c?.product_id ?? null,
        stockStatus: c?.stock_status ?? null,
        unitCost: c?.cost == null ? null : n(c.cost),
        ...k,
        profitAfterAds: grossProfit == null ? null : Math.round((grossProfit - k.cost) * 100) / 100,
      }
    }),
  }
}

export async function loadMadsTab(channel: AdsChannel, tab: MadsTab, r: Range) {
  switch (tab) {
    case 'overview':
      return loadOverview(channel, r)
    case 'campaigns':
      return loadCampaigns(channel, r)
    case 'products':
      return loadProducts(channel, r)
    case 'imports':
      return { rows: await listImports(ADS_MARKET[channel]) }
  }
}
