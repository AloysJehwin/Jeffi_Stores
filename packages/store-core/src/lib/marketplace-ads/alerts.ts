import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { istDate } from '@/lib/channels/report-store'
import { AADS_DEFAULTS, evaluateAads, type AadsAlertConfig, type AadsSnapshot } from '@/lib/amazon-ads/alerts'
import { ADS_MARKET, type AdsChannel } from './columns'

// Myntra Ads / AJIO Ads alerts: the Amazon Ads rules (ACoS over target, spend with no sales, ads on
// out-of-stock items) over imported report rows, plus "no report imported in N days". Run after
// each import and, at most every half hour, when the console is opened.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  acos_target: z.object({ enabled: z.boolean(), maxAcos: num(1, 500), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  spend_no_sales: z.object({ enabled: z.boolean(), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  ads_out_of_stock: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  no_recent_import: z.object({ enabled: z.boolean(), days: num(3, 60) }),
})
export type MadsAlertConfig = z.infer<typeof schema>

export const MADS_DEFAULTS: MadsAlertConfig = {
  acos_target: AADS_DEFAULTS.acos_target,
  spend_no_sales: AADS_DEFAULTS.spend_no_sales,
  ads_out_of_stock: AADS_DEFAULTS.ads_out_of_stock,
  no_recent_import: { enabled: true, days: 7 },
}

export interface MadsSnapshot extends Pick<AadsSnapshot, 'campaigns' | 'noSales' | 'outOfStock'> {
  lastImportAt: string | null
  coveredTo: string | null
}

const LABEL: Record<AdsChannel, string> = { myntra_ads: 'Myntra Ads', ajio_ads: 'AJIO Ads' }

export function evaluateMads(channel: AdsChannel, s: MadsSnapshot, cfg: MadsAlertConfig, now = new Date()): Finding[] {
  const aads: AadsAlertConfig = {
    ...AADS_DEFAULTS,
    acos_target: cfg.acos_target,
    spend_no_sales: cfg.spend_no_sales,
    ads_out_of_stock: cfg.ads_out_of_stock,
    wasted_terms: { ...AADS_DEFAULTS.wasted_terms, enabled: false },
    reports_stale: { ...AADS_DEFAULTS.reports_stale, enabled: false },
  }
  const out = evaluateAads({ ...s, wasted: [], lastReportAt: null }, aads, now).map(f =>
    f.rule === 'spend_no_sales' ? { ...f, message: `No attributed sales in ${cfg.spend_no_sales.days} days. Check its products and bids on the seller portal.` } : f
  )
  if (cfg.no_recent_import.enabled && s.lastImportAt) {
    const days = (now.getTime() - new Date(s.lastImportAt).getTime()) / 86_400_000
    if (days > cfg.no_recent_import.days) {
      out.push({
        rule: 'no_recent_import',
        key: 'no_recent_import',
        severity: 'warning',
        title: `No ${LABEL[channel]} report imported in ${Math.floor(days)} days`,
        message: `The last import${s.coveredTo ? ` covers up to ${s.coveredTo}` : ''}. Download the latest report from the seller portal and import it.`,
      })
    }
  }
  return out
}

// A product report with campaign names only joins the campaign report's ID for that name.
export const CAMPAIGN_NAMES = `nm AS (SELECT DISTINCT ON (campaign_name) campaign_name, campaign_key FROM marketplace_ad_daily
    WHERE channel = $1 AND campaign_name IS NOT NULL ORDER BY campaign_name, date DESC)`

// Campaign rows: the campaign report, or product rows on days with no campaign report.
const sourceSql = (since: string) => `
  WITH d AS (SELECT date, campaign_key, campaign_name, spend, sales FROM marketplace_ad_daily WHERE channel = $1 AND date >= ${since}),
  ${CAMPAIGN_NAMES},
  src AS (
    SELECT * FROM d
    UNION ALL
    SELECT p.date, COALESCE(nm.campaign_key, p.campaign_key), p.campaign_name, p.spend, p.sales
      FROM marketplace_ad_products p LEFT JOIN nm ON nm.campaign_name = p.campaign_name AND p.campaign_key = p.campaign_name
     WHERE p.channel = $1 AND p.date >= ${since} AND NOT EXISTS (SELECT 1 FROM d WHERE d.date = p.date)
  )`

async function loadSnapshot(channel: AdsChannel, cfg: MadsAlertConfig, now: Date): Promise<MadsSnapshot> {
  const market = ADS_MARKET[channel]
  const since = (days: number) => istDate(now, days)
  const byCampaign = (days: number, having: string) =>
    queryMany<any>(
      `${sourceSql('$2')}
       SELECT campaign_key, COALESCE(max(campaign_name), NULLIF(campaign_key, ''), '(no campaign)') AS name, SUM(spend) AS cost, SUM(sales) AS sales
         FROM src GROUP BY campaign_key ${having}`,
      [market, since(days)]
    ).catch(() => [])
  const [campaigns, noSales, oos, last] = await Promise.all([
    byCampaign(cfg.acos_target.days, ''),
    byCampaign(cfg.spend_no_sales.days, 'HAVING SUM(sales) = 0 AND SUM(spend) > 0'),
    queryMany<any>(
      `SELECT m.product_key, COALESCE(max(p.name), max(m.product_name)) AS name, SUM(m.spend) AS cost
         FROM marketplace_ad_products m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN product_variants v ON v.id = m.variant_id
         LEFT JOIN product_sub_variants sv ON sv.id = m.sub_variant_id
        WHERE m.channel = $1 AND m.date >= $2 AND COALESCE(sv.stock_status, v.stock_status, p.stock_status) = 'Out of Stock'
        GROUP BY m.product_key HAVING SUM(m.spend) > 0`,
      [market, since(cfg.ads_out_of_stock.days)]
    ).catch(() => []),
    queryOne<any>(`SELECT max(imported_at) AS at, max(date_to)::text AS covered_to FROM marketplace_ad_imports WHERE channel = $1`, [market]).catch(() => null),
  ])
  return {
    campaigns: campaigns.map(c => ({ campaignId: c.campaign_key, name: c.name, cost: Number(c.cost), sales: Number(c.sales) })),
    noSales: noSales.map(c => ({ campaignId: c.campaign_key, name: c.name, cost: Number(c.cost) })),
    outOfStock: oos.map(p => ({ sku: p.product_key, name: p.name, cost: Number(p.cost) })),
    lastImportAt: last?.at ? new Date(last.at).toISOString() : null,
    coveredTo: last?.covered_to ?? null,
  }
}

const cache = new Map<AdsChannel, RuleSet<MadsAlertConfig, MadsSnapshot>>()

export function adsRuleSet(channel: AdsChannel): RuleSet<MadsAlertConfig, MadsSnapshot> {
  let rs = cache.get(channel)
  if (!rs) {
    rs = {
      channel,
      schema: schema as any,
      defaults: MADS_DEFAULTS,
      labels: {
        acos_target: 'Campaign ACoS above target',
        spend_no_sales: 'Spending with no sales',
        ads_out_of_stock: 'Ads on out-of-stock products',
        no_recent_import: 'No report imported recently',
      },
      loadSnapshot: (cfg, now) => loadSnapshot(channel, cfg, now),
      evaluate: (s, cfg) => evaluateMads(channel, s, cfg),
    }
    cache.set(channel, rs)
  }
  return rs
}
