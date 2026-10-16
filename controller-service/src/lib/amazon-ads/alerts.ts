import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { istDate } from '@/lib/channels/report-store'

// Amazon Ads alert rules, run after each sync.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  acos_target: z.object({ enabled: z.boolean(), maxAcos: num(1, 500), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  spend_no_sales: z.object({ enabled: z.boolean(), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  wasted_terms: z.object({ enabled: z.boolean(), minClicks: num(1, 10_000), days: num(3, 30) }),
  ads_out_of_stock: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  reports_stale: z.object({ enabled: z.boolean(), hours: num(6, 168) }),
})
export type AadsAlertConfig = z.infer<typeof schema>

export const AADS_DEFAULTS: AadsAlertConfig = {
  acos_target: { enabled: true, maxAcos: 40, minSpend: 500, days: 14 },
  spend_no_sales: { enabled: true, minSpend: 500, days: 7 },
  wasted_terms: { enabled: true, minClicks: 15, days: 14 },
  ads_out_of_stock: { enabled: true, days: 3 },
  reports_stale: { enabled: true, hours: 36 },
}

export interface AadsSnapshot {
  campaigns: { campaignId: string; name: string; cost: number; sales: number }[]
  noSales: { campaignId: string; name: string; cost: number }[]
  wasted: { term: string; campaign: string | null; clicks: number; cost: number }[]
  outOfStock: { sku: string; name: string | null; cost: number }[]
  lastReportAt: string | null
}

export function evaluateAads(s: AadsSnapshot, cfg: AadsAlertConfig, now = new Date()): Finding[] {
  const out: Finding[] = []
  if (cfg.acos_target.enabled) {
    for (const c of s.campaigns) {
      if (c.cost < cfg.acos_target.minSpend || !c.sales) continue
      const acos = (c.cost / c.sales) * 100
      if (acos <= cfg.acos_target.maxAcos) continue
      out.push({
        rule: 'acos_target',
        key: `acos_target:${c.campaignId}`,
        severity: 'warning',
        title: `"${c.name}" ACoS is ${acos.toFixed(0)}%`,
        message: `Spent ${c.cost.toFixed(0)} for ${c.sales.toFixed(0)} in sales over ${cfg.acos_target.days} days (target ${cfg.acos_target.maxAcos}%).`,
        entityType: 'aads_campaign',
        entityId: c.campaignId,
      })
    }
  }
  if (cfg.spend_no_sales.enabled) {
    for (const c of s.noSales) {
      if (c.cost < cfg.spend_no_sales.minSpend) continue
      out.push({
        rule: 'spend_no_sales',
        key: `spend_no_sales:${c.campaignId}`,
        severity: 'critical',
        title: `"${c.name}" spent ${c.cost.toFixed(0)} with no sales`,
        message: `No attributed sales in ${cfg.spend_no_sales.days} days. Check its keywords and search terms.`,
        entityType: 'aads_campaign',
        entityId: c.campaignId,
      })
    }
  }
  if (cfg.wasted_terms.enabled) {
    const w = s.wasted.filter(t => t.clicks >= cfg.wasted_terms.minClicks)
    if (w.length) {
      out.push({
        rule: 'wasted_terms',
        key: `wasted_terms:${w.length}`,
        severity: 'warning',
        title: `${w.length} search term${w.length === 1 ? '' : 's'} with clicks and no orders`,
        message: w
          .slice(0, 3)
          .map(t => `"${t.term}" ${t.clicks} clicks, ${t.cost.toFixed(0)}`)
          .join(' · '),
      })
    }
  }
  if (cfg.ads_out_of_stock.enabled) {
    for (const p of s.outOfStock) {
      out.push({
        rule: 'ads_out_of_stock',
        key: `ads_out_of_stock:${p.sku}`,
        severity: 'warning',
        title: `Spending on ${p.name ?? p.sku}, which is out of stock`,
        message: `${p.cost.toFixed(0)} spent in ${cfg.ads_out_of_stock.days} days. Pause its ads or restock.`,
        entityType: 'sku',
        entityId: p.sku,
      })
    }
  }
  if (cfg.reports_stale.enabled && s.lastReportAt) {
    const hours = (now.getTime() - new Date(s.lastReportAt).getTime()) / 3_600_000
    if (hours > cfg.reports_stale.hours) {
      out.push({ rule: 'reports_stale', key: 'reports_stale', severity: 'warning', title: 'Amazon Ads reports have stopped updating', message: `The last report arrived ${Math.round(hours)} hours ago.` })
    }
  }
  return out
}

async function loadSnapshot(cfg: AadsAlertConfig, now: Date): Promise<AadsSnapshot> {
  const since = (days: number) => istDate(now, days)
  const [campaigns, noSales, wasted, oos, profile] = await Promise.all([
    queryMany<any>(
      `SELECT c.campaign_id, c.name, SUM(m.cost) AS cost, SUM(m.sales) AS sales FROM aads_daily_metrics m JOIN aads_campaigns c ON c.campaign_id = m.campaign_id
       WHERE m.date >= $1 AND c.state = 'ENABLED' GROUP BY c.campaign_id, c.name`,
      [since(cfg.acos_target.days)]
    ).catch(() => []),
    queryMany<any>(
      `SELECT c.campaign_id, c.name, SUM(m.cost) AS cost FROM aads_daily_metrics m JOIN aads_campaigns c ON c.campaign_id = m.campaign_id
       WHERE m.date >= $1 AND c.state = 'ENABLED' GROUP BY c.campaign_id, c.name HAVING SUM(m.sales) = 0`,
      [since(cfg.spend_no_sales.days)]
    ).catch(() => []),
    queryMany<any>(
      `SELECT t.search_term, max(c.name) AS campaign, SUM(t.clicks) AS clicks, SUM(t.cost) AS cost FROM aads_search_terms t LEFT JOIN aads_campaigns c ON c.campaign_id = t.campaign_id
       WHERE t.date >= $1 AND NOT EXISTS (SELECT 1 FROM aads_keywords k WHERE k.negative AND k.ad_group_id = t.ad_group_id AND lower(k.keyword_text) = lower(t.search_term))
       GROUP BY t.search_term HAVING SUM(t.orders) = 0 ORDER BY SUM(t.cost) DESC LIMIT 50`,
      [since(cfg.wasted_terms.days)]
    ).catch(() => []),
    queryMany<any>(
      `SELECT m.sku, max(p.name) AS name, SUM(m.cost) AS cost FROM aads_product_metrics m
       LEFT JOIN product_variants v ON v.sku = m.sku LEFT JOIN products p ON p.id = COALESCE(v.product_id, (SELECT id FROM products WHERE sku = m.sku LIMIT 1))
       WHERE m.date >= $1 AND COALESCE(v.stock_status, p.stock_status) = 'Out of Stock' GROUP BY m.sku HAVING SUM(m.cost) > 0`,
      [since(cfg.ads_out_of_stock.days)]
    ).catch(() => []),
    queryOne<any>(`SELECT last_report_at FROM aads_profile WHERE id = 1`).catch(() => null),
  ])
  return {
    campaigns: campaigns.map(c => ({ campaignId: c.campaign_id, name: c.name, cost: Number(c.cost), sales: Number(c.sales) })),
    noSales: noSales.map(c => ({ campaignId: c.campaign_id, name: c.name, cost: Number(c.cost) })),
    wasted: wasted.map(t => ({ term: t.search_term, campaign: t.campaign, clicks: Number(t.clicks), cost: Number(t.cost) })),
    outOfStock: oos.map(p => ({ sku: p.sku, name: p.name, cost: Number(p.cost) })),
    lastReportAt: profile?.last_report_at ?? null,
  }
}

export const AMAZON_ADS_RULES: RuleSet<AadsAlertConfig, AadsSnapshot> = {
  channel: 'amazon_ads',
  schema: schema as any,
  defaults: AADS_DEFAULTS,
  labels: {
    acos_target: 'Campaign ACoS above target',
    spend_no_sales: 'Spending with no sales',
    wasted_terms: 'Search terms with clicks and no orders',
    ads_out_of_stock: 'Ads on out-of-stock products',
    reports_stale: 'Reports stopped updating',
  },
  loadSnapshot: (cfg, now) => loadSnapshot(cfg, now),
  evaluate: (s, cfg) => evaluateAads(s, cfg),
}
