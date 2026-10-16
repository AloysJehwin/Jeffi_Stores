import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { Finding, RuleSet } from '@/lib/channels/alerts-engine'
import { istDate } from '@/lib/channels/report-store'
import { readMetaAdsConfig } from './client'

// Meta Ads alert rules, run after each sync and Conversions API run.

const num = (min: number, max: number) => z.number().min(min).max(max)

const schema = z.object({
  roas_target: z.object({ enabled: z.boolean(), minRoas: num(0, 100), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  spend_no_purchases: z.object({ enabled: z.boolean(), minSpend: num(0, 10_000_000), days: num(3, 30) }),
  disapproved_ads: z.object({ enabled: z.boolean() }),
  capi_failing: z.object({ enabled: z.boolean() }),
  token_expiry: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  account_problem: z.object({ enabled: z.boolean() }),
})
export type MadsAlertConfig = z.infer<typeof schema>

export const MADS_DEFAULTS: MadsAlertConfig = {
  roas_target: { enabled: false, minRoas: 2, minSpend: 1000, days: 7 },
  spend_no_purchases: { enabled: true, minSpend: 1000, days: 7 },
  disapproved_ads: { enabled: true },
  capi_failing: { enabled: true },
  token_expiry: { enabled: true, days: 7 },
  account_problem: { enabled: true },
}

export interface MadsSnapshot {
  campaigns: { id: string; name: string; spend: number; purchases: number; value: number }[]
  disapproved: { id: string; name: string }[]
  capiFailed: number
  tokenExpiresAt: string | null
  accountStatus: number | null
}

// Meta account_status: 1 active, 2 disabled, 3 unsettled, 7 pending risk review, 9 in grace period, 101 closed.
const ACCOUNT_STATUS: Record<number, string> = {
  2: 'disabled',
  3: 'has an unpaid balance',
  7: 'under risk review',
  9: 'in a grace period',
  101: 'closed',
}

export function evaluateMads(s: MadsSnapshot, cfg: MadsAlertConfig, now = new Date()): Finding[] {
  const out: Finding[] = []
  for (const c of s.campaigns) {
    if (cfg.spend_no_purchases.enabled && c.spend >= cfg.spend_no_purchases.minSpend && c.purchases === 0) {
      out.push({
        rule: 'spend_no_purchases',
        key: `spend_no_purchases:${c.id}`,
        severity: 'critical',
        title: `"${c.name}" spent ${c.spend.toFixed(0)} with no purchases`,
        message: `No purchases attributed in ${cfg.spend_no_purchases.days} days.`,
        entityType: 'meta_campaign',
        entityId: c.id,
      })
    } else if (
      cfg.roas_target.enabled &&
      c.spend >= cfg.roas_target.minSpend &&
      c.value / c.spend < cfg.roas_target.minRoas
    ) {
      out.push({
        rule: 'roas_target',
        key: `roas_target:${c.id}`,
        severity: 'warning',
        title: `"${c.name}" ROAS is ${(c.value / c.spend).toFixed(2)}x`,
        message: `Below your ${cfg.roas_target.minRoas}x target over ${cfg.roas_target.days} days.`,
        entityType: 'meta_campaign',
        entityId: c.id,
      })
    }
  }
  if (cfg.disapproved_ads.enabled && s.disapproved.length) {
    out.push({
      rule: 'disapproved_ads',
      key: `disapproved_ads:${s.disapproved.length}`,
      severity: 'warning',
      title: `${s.disapproved.length} Meta ad${s.disapproved.length === 1 ? ' was' : 's were'} rejected`,
      message: s.disapproved
        .slice(0, 3)
        .map(a => a.name)
        .join(' · '),
    })
  }
  if (cfg.capi_failing.enabled && s.capiFailed > 0) {
    out.push({
      rule: 'capi_failing',
      key: 'capi_failing',
      severity: 'critical',
      title: `${s.capiFailed} purchase${s.capiFailed === 1 ? '' : 's'} could not be sent to Meta`,
      message: 'Conversions API sends are failing; see the Conversions tab.',
    })
  }
  if (cfg.token_expiry.enabled && s.tokenExpiresAt) {
    const days = (new Date(s.tokenExpiresAt).getTime() - now.getTime()) / 86_400_000
    if (days <= cfg.token_expiry.days) {
      out.push({
        rule: 'token_expiry',
        key: 'token_expiry',
        severity: days <= 0 ? 'critical' : 'warning',
        title:
          days <= 0
            ? 'The Meta Ads connection has expired'
            : `The Meta Ads connection expires in ${Math.ceil(days)} days`,
        message: 'Reconnect Meta Ads, or enter a system user token that does not expire.',
      })
    }
  }
  if (cfg.account_problem.enabled && s.accountStatus != null && ACCOUNT_STATUS[s.accountStatus]) {
    out.push({
      rule: 'account_problem',
      key: `account_problem:${s.accountStatus}`,
      severity: 'critical',
      title: `The Meta ad account is ${ACCOUNT_STATUS[s.accountStatus]}`,
      message: 'Ads are not running. Resolve it in Meta Business Suite.',
    })
  }
  return out
}

async function loadSnapshot(cfg: MadsAlertConfig, now: Date): Promise<MadsSnapshot> {
  const days = Math.max(cfg.roas_target.days, cfg.spend_no_purchases.days)
  const [campaigns, disapproved, capi, account, conn] = await Promise.all([
    queryMany<any>(
      `SELECT c.campaign_id, c.name, SUM(m.spend) AS spend, SUM(m.purchases) AS purchases, SUM(m.purchase_value) AS value FROM mads_daily_metrics m
       JOIN mads_campaigns c ON c.campaign_id = m.campaign_id WHERE m.date >= $1 AND c.status = 'ACTIVE' GROUP BY c.campaign_id, c.name`,
      [istDate(now, days)]
    ).catch(() => []),
    queryMany<any>(`SELECT ad_id, name FROM mads_ads WHERE effective_status = 'DISAPPROVED' LIMIT 50`).catch(() => []),
    queryOne<any>(
      `SELECT count(*) AS n FROM mads_capi_events WHERE status = 'failed' AND created_at > now() - interval '2 days'`
    ).catch(() => null),
    queryOne<any>(`SELECT account_status FROM mads_account WHERE id = 1`).catch(() => null),
    readMetaAdsConfig().catch(() => null),
  ])
  return {
    campaigns: campaigns.map(c => ({
      id: c.campaign_id,
      name: c.name,
      spend: Number(c.spend),
      purchases: Number(c.purchases),
      value: Number(c.value),
    })),
    disapproved: disapproved.map(a => ({ id: a.ad_id, name: a.name })),
    capiFailed: Number(capi?.n ?? 0),
    tokenExpiresAt: conn?.token_expires_at ?? null,
    accountStatus: account?.account_status ?? null,
  }
}

export const META_ADS_RULES: RuleSet<MadsAlertConfig, MadsSnapshot> = {
  channel: 'meta_ads',
  schema: schema as any,
  defaults: MADS_DEFAULTS,
  labels: {
    roas_target: 'Campaign ROAS below target',
    spend_no_purchases: 'Spending with no purchases',
    disapproved_ads: 'Rejected ads',
    capi_failing: 'Conversions API failing',
    token_expiry: 'Connection about to expire',
    account_problem: 'Ad account disabled or unpaid',
  },
  loadSnapshot: (cfg, now) => loadSnapshot(cfg, now),
  evaluate: (s, cfg) => evaluateMads(s, cfg),
}
