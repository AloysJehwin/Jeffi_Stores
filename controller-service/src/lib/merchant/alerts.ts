import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'

// Merchant Center alert rules, run after the daily reports refresh and the status refresh.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  disapproved_share: z.object({ enabled: z.boolean(), percent: num(1, 100), minProducts: num(1, 100_000) }),
  account_issue: z.object({ enabled: z.boolean() }),
  uncompetitive_price: z.object({ enabled: z.boolean(), percent: num(1, 200), minClicks: num(0, 100_000), days: num(1, 30) }),
  best_seller_not_listed: z.object({ enabled: z.boolean() }),
  sync_failed: z.object({ enabled: z.boolean() }),
})
export type GmcAlertConfig = z.infer<typeof schema>

export const GMC_DEFAULTS: GmcAlertConfig = {
  disapproved_share: { enabled: true, percent: 10, minProducts: 20 },
  account_issue: { enabled: true },
  uncompetitive_price: { enabled: true, percent: 10, minClicks: 20, days: 14 },
  best_seller_not_listed: { enabled: true },
  sync_failed: { enabled: true },
}

export interface GmcAlertSnapshot {
  status: { total: number; disapproved: number } | null
  accountIssues: { name: string; title: string; severity: string }[]
  overpriced: { offerId: string; title: string | null; price: number; benchmark: number; clicks: number }[]
  notListed: { title: string | null; rank: number; category: string | null }[]
  lastSync: { status: string; finishedAt: string | null; errors: number } | null
}

export function evaluateGmc(s: GmcAlertSnapshot, cfg: GmcAlertConfig): Finding[] {
  const out: Finding[] = []
  if (cfg.disapproved_share.enabled && s.status && s.status.total >= cfg.disapproved_share.minProducts) {
    const share = s.status.disapproved / s.status.total
    if (share * 100 >= cfg.disapproved_share.percent) {
      out.push({
        rule: 'disapproved_share',
        key: 'disapproved_share',
        severity: share >= 0.3 ? 'critical' : 'warning',
        title: `${s.status.disapproved} of ${s.status.total} products are disapproved`,
        message: `${(share * 100).toFixed(1)}% of your Merchant Center products are not shown. Open Products to see why.`,
      })
    }
  }
  if (cfg.account_issue.enabled) {
    for (const i of s.accountIssues) {
      if (i.severity !== 'CRITICAL' && i.severity !== 'ERROR') continue
      out.push({
        rule: 'account_issue',
        key: `account_issue:${i.name}`,
        severity: i.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: `Account issue: ${i.title}`,
        message: 'Google reported a problem with your Merchant Center account. See the Account tab.',
        entityType: 'gmc_account_issue',
        entityId: i.name,
      })
    }
  }
  if (cfg.uncompetitive_price.enabled) {
    for (const p of s.overpriced) {
      if (p.clicks < cfg.uncompetitive_price.minClicks) continue
      const over = (p.price - p.benchmark) / p.benchmark
      if (over * 100 < cfg.uncompetitive_price.percent) continue
      out.push({
        rule: 'uncompetitive_price',
        key: `uncompetitive_price:${p.offerId}`,
        severity: 'warning',
        title: `${p.title ?? p.offerId} is ${(over * 100).toFixed(0)}% above the market price`,
        message: `Your price ${p.price.toFixed(0)} vs benchmark ${p.benchmark.toFixed(0)}, with ${p.clicks} clicks in ${cfg.uncompetitive_price.days} days.`,
        entityType: 'gmc_offer',
        entityId: p.offerId,
      })
    }
  }
  if (cfg.best_seller_not_listed.enabled && s.notListed.length) {
    out.push({
      rule: 'best_seller_not_listed',
      key: `best_seller_not_listed:${s.notListed.length}`,
      severity: 'info',
      title: `${s.notListed.length} best-selling product${s.notListed.length === 1 ? '' : 's'} you carry ${s.notListed.length === 1 ? 'is' : 'are'} not showing on Google`,
      message: s.notListed
        .slice(0, 3)
        .map(n => `#${n.rank} ${n.title ?? ''}`)
        .join(' · '),
    })
  }
  if (cfg.sync_failed.enabled && s.lastSync && s.lastSync.status !== 'success' && s.lastSync.status !== 'running') {
    out.push({
      rule: 'sync_failed',
      key: `sync_failed:${s.lastSync.finishedAt ?? 'last'}`,
      severity: s.lastSync.status === 'error' ? 'critical' : 'warning',
      title: `The last product push ${s.lastSync.status === 'error' ? 'failed' : 'had errors'}`,
      message: `${s.lastSync.errors} error group(s). Open Products for details and retry.`,
    })
  }
  return out
}

export async function loadGmcSnapshot(cfg: GmcAlertConfig): Promise<GmcAlertSnapshot> {
  const [status, accountIssues, overpriced, notListed, lastSync] = await Promise.all([
    queryOne<{ total: number; disapproved: number }>(`SELECT total, disapproved FROM merchant_gmc_refresh_meta WHERE id = 1`).catch(() => null),
    queryMany<{ name: string; title: string; severity: string }>(`SELECT name, title, severity FROM gmc_account_issues`).catch(() => []),
    queryMany<{ offer_id: string; title: string | null; price: string; benchmark_price: string; clicks: string }>(
      `SELECT c.offer_id, c.title, c.price, c.benchmark_price, COALESCE(SUM(p.clicks), 0) AS clicks
       FROM gmc_price_competitiveness c
       LEFT JOIN gmc_product_performance p ON p.offer_id = c.offer_id AND p.date >= current_date - $1::int
       WHERE c.price IS NOT NULL AND c.benchmark_price > 0 AND c.price > c.benchmark_price
       GROUP BY c.offer_id, c.title, c.price, c.benchmark_price
       ORDER BY clicks DESC LIMIT 50`,
      [cfg.uncompetitive_price.days]
    ).catch(() => []),
    queryMany<{ title: string | null; rank: number; category_l1: string | null }>(
      `SELECT title, rank, category_l1 FROM gmc_best_sellers WHERE catalog_status = 'not_listed' ORDER BY rank LIMIT 50`
    ).catch(() => []),
    queryOne<{ status: string; finished_at: string | null; errors: unknown }>(
      `SELECT status, finished_at, errors FROM merchant_sync_log ORDER BY started_at DESC LIMIT 1`
    ).catch(() => null),
  ])
  return {
    status: status ? { total: Number(status.total), disapproved: Number(status.disapproved) } : null,
    accountIssues,
    overpriced: overpriced.map(o => ({
      offerId: o.offer_id,
      title: o.title,
      price: Number(o.price),
      benchmark: Number(o.benchmark_price),
      clicks: Number(o.clicks),
    })),
    notListed: notListed.map(n => ({ title: n.title, rank: n.rank, category: n.category_l1 })),
    lastSync: lastSync
      ? { status: lastSync.status, finishedAt: lastSync.finished_at, errors: Array.isArray(lastSync.errors) ? lastSync.errors.length : 0 }
      : null,
  }
}

export const GMC_RULES: RuleSet<GmcAlertConfig, GmcAlertSnapshot> = {
  channel: 'gmc',
  schema: schema as any,
  defaults: GMC_DEFAULTS,
  labels: {
    disapproved_share: 'Share of disapproved products',
    account_issue: 'Account-level issues',
    uncompetitive_price: 'Priced above the market on products with clicks',
    best_seller_not_listed: 'Best sellers you carry that are not showing',
    sync_failed: 'Product push failed',
  },
  loadSnapshot: cfg => loadGmcSnapshot(cfg),
  evaluate: evaluateGmc,
}
