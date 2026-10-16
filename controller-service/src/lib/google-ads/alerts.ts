import { z } from 'zod'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { escapeHtml, mailShell } from '@/lib/shared/mail-template'
import { computeReturnMetrics, googleAdsOrderStats, hasAttributionColumns } from './attribution'
import { dateInZone } from './sync'
import { SETTING, adsConsoleUrl, adsRecipients, flag, readSetting, writeSettings } from './notify'

// Rules run after each Google Ads sync over the local mirror and our orders. A finding is keyed
// (dedupe_key) so the same condition keeps one open alert until it clears; new alerts from one run
// go out together as one bell notification and one email, and a key notified in the last 24 hours
// is not notified again if it flaps.

export const ALERT_RULES = [
  'budget_pacing',
  'spend_spike',
  'cpa_roas_target',
  'zero_conversions',
  'tracking_stopped',
  'disapproved_ads',
  'merchant_disapproved',
  'out_of_stock_ads',
  'account_problems',
] as const
export type AlertRule = (typeof ALERT_RULES)[number]
export type Severity = 'info' | 'warning' | 'critical'

const num = (min: number, max: number) => z.number().min(min).max(max)

export const AlertConfigSchema = z.object({
  budget_pacing: z.object({ enabled: z.boolean(), pacePercent: num(10, 100), beforeHour: num(1, 23) }),
  spend_spike: z.object({ enabled: z.boolean(), percent: num(10, 1000), minSpend: num(0, 10_000_000) }),
  cpa_roas_target: z.object({ enabled: z.boolean(), maxCpa: num(0, 10_000_000), minRoas: num(0, 100), days: num(3, 30) }),
  zero_conversions: z.object({ enabled: z.boolean(), days: num(1, 30), minSpend: num(0, 10_000_000) }),
  tracking_stopped: z.object({ enabled: z.boolean(), days: num(1, 30), minClicks: num(1, 100_000) }),
  disapproved_ads: z.object({ enabled: z.boolean() }),
  merchant_disapproved: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  out_of_stock_ads: z.object({ enabled: z.boolean(), days: num(1, 30) }),
  account_problems: z.object({ enabled: z.boolean(), budgetPercent: num(50, 100) }),
})
export type AlertConfig = z.infer<typeof AlertConfigSchema>

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  budget_pacing: { enabled: true, pacePercent: 80, beforeHour: 14 },
  spend_spike: { enabled: true, percent: 50, minSpend: 500 },
  cpa_roas_target: { enabled: false, maxCpa: 0, minRoas: 0, days: 7 },
  zero_conversions: { enabled: true, days: 3, minSpend: 300 },
  tracking_stopped: { enabled: true, days: 3, minClicks: 30 },
  disapproved_ads: { enabled: true },
  merchant_disapproved: { enabled: true, days: 14 },
  out_of_stock_ads: { enabled: true, days: 3 },
  account_problems: { enabled: true, budgetPercent: 90 },
}

export const RULE_LABEL: Record<AlertRule, string> = {
  budget_pacing: 'Budget pacing',
  spend_spike: 'Spend spike',
  cpa_roas_target: 'CPA / ROAS target',
  zero_conversions: 'No conversions while spending',
  tracking_stopped: 'Tracking stopped',
  disapproved_ads: 'Disapproved ads',
  merchant_disapproved: 'Merchant products disapproved',
  out_of_stock_ads: 'Ads on out-of-stock items',
  account_problems: 'Account and billing',
}

export interface NotifySettings {
  emails: boolean
  digest: boolean
}

export async function getAlertConfig(): Promise<AlertConfig> {
  const raw = await readSetting(SETTING.alertRules)
  return mergeConfig(raw)
}

/** Stored overrides on the defaults, rule by rule; an invalid rule falls back to its default. */
export function mergeConfig(raw: string | null): AlertConfig {
  let stored: Record<string, unknown> = {}
  try {
    stored = raw ? JSON.parse(raw) : {}
  } catch {
    stored = {}
  }
  const out = { ...DEFAULT_ALERT_CONFIG } as Record<AlertRule, unknown>
  for (const rule of ALERT_RULES) {
    const merged = { ...(DEFAULT_ALERT_CONFIG[rule] as object), ...((stored[rule] as object) ?? {}) }
    const ok = AlertConfigSchema.shape[rule].safeParse(merged)
    if (ok.success) out[rule] = ok.data
  }
  return out as AlertConfig
}

export async function getNotifySettings(): Promise<NotifySettings> {
  const [emails, digest] = await Promise.all([readSetting(SETTING.alertEmails), readSetting(SETTING.digest)])
  return { emails: flag(emails, true), digest: flag(digest, true) }
}

export async function saveAlertSettings(cfg: AlertConfig, n: NotifySettings): Promise<void> {
  await writeSettings({
    [SETTING.alertRules]: JSON.stringify(cfg),
    [SETTING.alertEmails]: String(n.emails),
    [SETTING.digest]: String(n.digest),
  })
}

// ---- Evaluation over a snapshot (pure) ----

export interface Finding {
  rule: AlertRule
  key: string
  severity: Severity
  title: string
  message: string
  entityType?: string
  entityId?: string
  data?: Record<string, unknown>
}

export interface AlertSnapshot {
  today: string
  hour: number
  currency: string
  campaigns: { campaignId: string; name: string; dailyBudget: number | null; todayCost: number; limitedByBudget: boolean }[]
  /** Account totals per day, oldest first, ending today. */
  daily: { date: string; cost: number; clicks: number; conversions: number }[]
  /** Enabled campaigns over the zero-conversions window (complete days). */
  campaignWindow: { campaignId: string; name: string; cost: number; conversions: number }[]
  /** Click-id orders in the tracking window; null when the store has no attribution columns. */
  attributedOrders: number | null
  window: { cost: number; conversions: number; trueRoas: number | null; googleRoas: number | null }
  disapprovedAds: { adGroupId: string; adId: string; name: string | null; campaignName: string | null; topics: string[] }[]
  merchantDisapproved: { itemId: string; title: string | null; cost: number }[]
  outOfStock: { itemId: string; title: string | null; sku: string | null; cost: number }[]
  account: { status: string | null; budgetStatus: string | null; budgetLimit: number | null; budgetServed: number | null } | null
}

const money = (v: number, c: string) => `${c === 'INR' ? '₹' : `${c} `}${Math.round(v).toLocaleString('en-IN')}`

/** Days strictly before `today`, `n` of them, as [first, last]. */
export function completeDays(today: string, n: number): [string, string] {
  const end = new Date(`${today}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (n - 1))
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
}

export function evaluateRules(s: AlertSnapshot, cfg: AlertConfig): Finding[] {
  const out: Finding[] = []
  const c = s.currency
  const r = cfg

  if (r.budget_pacing.enabled) {
    for (const k of s.campaigns) {
      if (k.dailyBudget && k.dailyBudget > 0 && s.hour < r.budget_pacing.beforeHour && k.todayCost >= (k.dailyBudget * r.budget_pacing.pacePercent) / 100) {
        out.push({
          rule: 'budget_pacing',
          key: `budget_pacing:${k.campaignId}:${s.today}`,
          severity: 'warning',
          title: `"${k.name}" spent ${Math.round((k.todayCost / k.dailyBudget) * 100)}% of its daily budget before ${r.budget_pacing.beforeHour}:00`,
          message: `${money(k.todayCost, c)} of ${money(k.dailyBudget, c)} spent today. Ads may stop showing later in the day.`,
          entityType: 'campaign',
          entityId: k.campaignId,
        })
      }
      if (k.limitedByBudget) {
        out.push({
          rule: 'budget_pacing',
          key: `budget_limited:${k.campaignId}`,
          severity: 'info',
          title: `"${k.name}" is limited by budget`,
          message: 'Google recommends a higher budget for this campaign. Check the Recommendations tab for the effect on profit.',
          entityType: 'campaign',
          entityId: k.campaignId,
        })
      }
    }
  }

  const complete = s.daily.filter(d => d.date < s.today)
  if (r.spend_spike.enabled && complete.length >= 8) {
    const last = complete[complete.length - 1]
    const prior = complete.slice(-8, -1)
    const avg = prior.reduce((a, d) => a + d.cost, 0) / prior.length
    if (last.cost >= r.spend_spike.minSpend && avg > 0 && last.cost > avg * (1 + r.spend_spike.percent / 100)) {
      out.push({
        rule: 'spend_spike',
        key: `spend_spike:${last.date}`,
        severity: 'warning',
        title: `Spend on ${last.date} was ${Math.round((last.cost / avg - 1) * 100)}% above the 7-day average`,
        message: `${money(last.cost, c)} against an average of ${money(avg, c)} a day.`,
        data: { date: last.date, cost: last.cost, average: Math.round(avg * 100) / 100 },
      })
    }
  }

  if (r.cpa_roas_target.enabled && s.window.cost > 0) {
    const { maxCpa, minRoas, days } = r.cpa_roas_target
    if (maxCpa > 0) {
      const cpa = s.window.conversions > 0 ? s.window.cost / s.window.conversions : Infinity
      if (cpa > maxCpa) {
        out.push({
          rule: 'cpa_roas_target',
          key: 'cpa_target',
          severity: 'warning',
          title: `Cost per conversion is above your target of ${money(maxCpa, c)}`,
          message: `${Number.isFinite(cpa) ? money(cpa, c) : 'No conversions'} over the last ${days} days (${money(s.window.cost, c)} spent).`,
        })
      }
    }
    const roas = s.window.trueRoas ?? s.window.googleRoas
    if (minRoas > 0 && roas != null && roas < minRoas) {
      out.push({
        rule: 'cpa_roas_target',
        key: 'roas_target',
        severity: 'warning',
        title: `ROAS ${roas.toFixed(2)}x is below your target of ${minRoas}x`,
        message: `${s.window.trueRoas != null ? 'True ROAS from your own orders' : "Google's ROAS"} over the last ${days} days.`,
      })
    }
  }

  if (r.zero_conversions.enabled) {
    for (const k of s.campaignWindow) {
      if (k.cost >= r.zero_conversions.minSpend && k.conversions <= 0) {
        out.push({
          rule: 'zero_conversions',
          key: `zero_conversions:${k.campaignId}`,
          severity: 'warning',
          title: `"${k.name}" had no conversions in ${r.zero_conversions.days} days`,
          message: `${money(k.cost, c)} spent with no conversions recorded by Google.`,
          entityType: 'campaign',
          entityId: k.campaignId,
        })
      }
    }
  }

  if (r.tracking_stopped.enabled && s.attributedOrders != null) {
    const [from] = completeDays(s.today, r.tracking_stopped.days)
    const clicks = s.daily.filter(d => d.date >= from).reduce((a, d) => a + d.clicks, 0)
    if (clicks >= r.tracking_stopped.minClicks && s.attributedOrders === 0) {
      out.push({
        rule: 'tracking_stopped',
        key: 'tracking_stopped',
        severity: 'critical',
        title: `No orders from Google Ads clicks in ${r.tracking_stopped.days} days`,
        message: `${clicks} ad clicks but no order carried a Google click id. Check the Google tag, the cookie banner and checkout.`,
      })
    }
  }

  if (r.disapproved_ads.enabled) {
    for (const a of s.disapprovedAds) {
      out.push({
        rule: 'disapproved_ads',
        key: `disapproved_ad:${a.adGroupId}~${a.adId}`,
        severity: 'warning',
        title: `Ad disapproved${a.campaignName ? ` in "${a.campaignName}"` : ''}`,
        message: `${a.name || `Ad ${a.adId}`}${a.topics.length ? `: ${a.topics.join(', ')}` : ''}`,
        entityType: 'ad',
        entityId: `${a.adGroupId}~${a.adId}`,
      })
    }
  }

  if (r.merchant_disapproved.enabled) {
    for (const p of s.merchantDisapproved) {
      out.push({
        rule: 'merchant_disapproved',
        key: `merchant_disapproved:${p.itemId}`,
        severity: 'warning',
        title: `Merchant Center disapproved "${p.title || p.itemId}"`,
        message: `It had ${money(p.cost, c)} of ad spend in the last ${r.merchant_disapproved.days} days and no longer shows in Shopping ads.`,
        entityType: 'product',
        entityId: p.itemId,
      })
    }
  }

  if (r.out_of_stock_ads.enabled) {
    for (const p of s.outOfStock) {
      out.push({
        rule: 'out_of_stock_ads',
        key: `oos_ads:${p.itemId}`,
        severity: 'warning',
        title: `Ads are running on out-of-stock "${p.title || p.sku || p.itemId}"`,
        message: `${money(p.cost, c)} spent in the last ${r.out_of_stock_ads.days} days on an item you cannot sell.`,
        entityType: 'product',
        entityId: p.itemId,
      })
    }
  }

  if (r.account_problems.enabled && s.account) {
    const a = s.account
    if (a.status && a.status !== 'ENABLED') {
      out.push({ rule: 'account_problems', key: 'account_status', severity: 'critical', title: `Google Ads account is ${a.status.toLowerCase()}`, message: 'Ads are not running. Check the account in Google Ads.' })
    }
    if (a.budgetStatus && !['APPROVED', 'PENDING'].includes(a.budgetStatus)) {
      out.push({ rule: 'account_problems', key: `account_budget:${a.budgetStatus}`, severity: 'critical', title: `Account budget is ${a.budgetStatus.toLowerCase()}`, message: 'Billing may stop ads. Check Billing in Google Ads.' })
    }
    if (a.budgetLimit && a.budgetServed != null && a.budgetServed >= (a.budgetLimit * r.account_problems.budgetPercent) / 100) {
      out.push({
        rule: 'account_problems',
        key: 'account_budget_low',
        severity: 'critical',
        title: `Account budget ${Math.round((a.budgetServed / a.budgetLimit) * 100)}% used`,
        message: `${money(a.budgetServed, c)} of ${money(a.budgetLimit, c)}. Ads stop when it runs out.`,
      })
    }
  }
  return out
}

// ---- Snapshot from the mirror ----

const n = (v: unknown) => Number(v ?? 0) || 0
const OFFER_ID_SQL = (col: string) => `lower(regexp_replace(${col}, '[^a-zA-Z0-9_:.-]', '_', 'g'))`

export async function loadSnapshot(cfg: AlertConfig, now = new Date()): Promise<AlertSnapshot> {
  const acc = await queryOne<any>(`SELECT * FROM ads_account WHERE id = 1`).catch(() => null)
  const tz = acc?.time_zone || 'Asia/Kolkata'
  const today = dateInZone(now, tz)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now)) || 0
  const [zFrom, zTo] = completeDays(today, cfg.zero_conversions.days)
  const [tFrom] = completeDays(today, cfg.tracking_stopped.days)
  const [wFrom, wTo] = completeDays(today, cfg.cpa_roas_target.days)
  const [mFrom] = completeDays(today, cfg.merchant_disapproved.days)
  const [oFrom] = completeDays(today, cfg.out_of_stock_ads.days)

  const [campaigns, daily, campaignWindow, window, disapproved, merchant, oos] = await Promise.all([
    queryMany(
      `SELECT c.campaign_id::text AS campaign_id, c.name, c.budget_amount_micros, c.budget_period,
         COALESCE((SELECT SUM(m.cost_micros) FROM ads_daily_metrics m WHERE m.campaign_id = c.campaign_id AND m.ad_group_id = 0 AND m.date = $1), 0) AS today_cost,
         EXISTS (SELECT 1 FROM ads_recommendations r WHERE r.campaign_id = c.campaign_id AND NOT r.dismissed
                   AND r.type IN ('CAMPAIGN_BUDGET', 'FORECASTING_CAMPAIGN_BUDGET')) AS limited
       FROM ads_campaigns c WHERE c.status = 'ENABLED'`,
      [today]
    ).catch(() => []),
    queryMany(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS date, COALESCE(SUM(m.cost_micros), 0) AS cost_micros,
         COALESCE(SUM(m.clicks), 0) AS clicks, COALESCE(SUM(m.conversions), 0) AS conversions
       FROM generate_series($1::date - 15, $1::date, interval '1 day') d
       LEFT JOIN ads_daily_metrics m ON m.date = d::date AND m.ad_group_id = 0
       GROUP BY d ORDER BY d`,
      [today]
    ).catch(() => []),
    queryMany(
      `SELECT c.campaign_id::text AS campaign_id, c.name, COALESCE(SUM(m.cost_micros), 0) AS cost_micros, COALESCE(SUM(m.conversions), 0) AS conversions
       FROM ads_campaigns c JOIN ads_daily_metrics m ON m.campaign_id = c.campaign_id AND m.ad_group_id = 0 AND m.date BETWEEN $1 AND $2
       WHERE c.status = 'ENABLED' AND COALESCE(c.start_date, '1970-01-01') <= $1::date
       GROUP BY c.campaign_id, c.name`,
      [zFrom, zTo]
    ).catch(() => []),
    queryOne(
      `SELECT COALESCE(SUM(cost_micros), 0) AS cost_micros, COALESCE(SUM(conversions), 0) AS conversions, COALESCE(SUM(conversions_value), 0) AS value
       FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2`,
      [wFrom, wTo]
    ).catch(() => null),
    queryMany(
      `SELECT a.ad_group_id::text, a.ad_id::text, a.name, a.policy_topics, c.name AS campaign_name
       FROM ads_ads a JOIN ads_campaigns c ON c.campaign_id = a.campaign_id AND c.status = 'ENABLED'
       WHERE a.approval_status = 'DISAPPROVED' AND a.status = 'ENABLED' LIMIT 100`
    ).catch(() => []),
    queryMany(
      `SELECT m.item_id, MAX(m.product_title) AS title, SUM(m.cost_micros) AS cost_micros
       FROM ads_product_metrics m JOIN merchant_gmc_status g ON lower(g.offer_id) = m.item_id AND g.status = 'disapproved'
       WHERE m.date >= $1 GROUP BY m.item_id HAVING SUM(m.cost_micros) > 0 ORDER BY 3 DESC LIMIT 50`,
      [mFrom]
    ).catch(() => []),
    queryMany(
      `WITH m AS (SELECT item_id, MAX(product_title) AS title, SUM(cost_micros) AS cost_micros FROM ads_product_metrics
                  WHERE date >= $1 GROUP BY item_id HAVING SUM(cost_micros) > 0)
       SELECT m.*, x.sku FROM m
       JOIN LATERAL (
         SELECT v.sku, v.stock_status, v.inventory_quantity AS qty FROM product_variants v WHERE ${OFFER_ID_SQL('v.sku')} = m.item_id
         UNION ALL
         SELECT p.sku, p.stock_status, p.inventory_quantity FROM products p WHERE ${OFFER_ID_SQL('p.sku')} = m.item_id
         LIMIT 1
       ) x ON TRUE
       WHERE (x.stock_status = 'Out of Stock' OR (x.stock_status IS NULL AND x.qty <= 0))
       ORDER BY m.cost_micros DESC LIMIT 50`,
      [oFrom]
    ).catch(() => []),
  ])

  let attributedOrders: number | null = null
  if (await hasAttributionColumns()) {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM orders WHERE (gclid IS NOT NULL OR gbraid IS NOT NULL OR wbraid IS NOT NULL)
         AND (created_at AT TIME ZONE $2)::date >= $1::date`,
      [tFrom, tz]
    ).catch(() => null)
    attributedOrders = row?.n ?? 0
  }

  const wCost = n(window?.cost_micros) / 1e6
  let trueRoas: number | null = null
  if (cfg.cpa_roas_target.enabled && cfg.cpa_roas_target.minRoas > 0) {
    const stats = await googleAdsOrderStats({ from: wFrom, to: wTo }, tz).catch(() => null)
    if (stats?.available && stats.orders > 0) trueRoas = computeReturnMetrics(wCost, stats).trueRoas
  }

  return {
    today,
    hour,
    currency: acc?.currency_code || 'INR',
    campaigns: campaigns.map((r: any) => ({
      campaignId: r.campaign_id,
      name: r.name,
      dailyBudget: r.budget_amount_micros != null && (r.budget_period ?? 'DAILY') === 'DAILY' ? n(r.budget_amount_micros) / 1e6 : null,
      todayCost: n(r.today_cost) / 1e6,
      limitedByBudget: !!r.limited,
    })),
    daily: daily.map((r: any) => ({ date: r.date, cost: n(r.cost_micros) / 1e6, clicks: n(r.clicks), conversions: n(r.conversions) })),
    campaignWindow: campaignWindow.map((r: any) => ({ campaignId: r.campaign_id, name: r.name, cost: n(r.cost_micros) / 1e6, conversions: n(r.conversions) })),
    attributedOrders,
    window: { cost: wCost, conversions: n(window?.conversions), trueRoas, googleRoas: wCost > 0 ? n(window?.value) / wCost : null },
    disapprovedAds: disapproved.map((r: any) => ({
      adGroupId: r.ad_group_id,
      adId: r.ad_id,
      name: r.name,
      campaignName: r.campaign_name,
      topics: (Array.isArray(r.policy_topics) ? r.policy_topics : []).map((t: any) => String(t?.topic ?? '').replace(/_/g, ' ').toLowerCase()).filter(Boolean),
    })),
    merchantDisapproved: merchant.map((r: any) => ({ itemId: r.item_id, title: r.title, cost: n(r.cost_micros) / 1e6 })),
    outOfStock: oos.map((r: any) => ({ itemId: r.item_id, title: r.title, sku: r.sku ?? null, cost: n(r.cost_micros) / 1e6 })),
    account: acc
      ? {
          status: acc.status ?? null,
          budgetStatus: acc.budget_status ?? null,
          budgetLimit: acc.budget_limit_micros == null ? null : n(acc.budget_limit_micros) / 1e6,
          budgetServed: acc.budget_served_micros == null ? null : n(acc.budget_served_micros) / 1e6,
        }
      : null,
  }
}

// ---- Persisting, de-duplicating, notifying ----

export interface AlertRow {
  id: string
  rule: AlertRule
  dedupe_key: string
  severity: Severity
  title: string
  message: string | null
  entity_type: string | null
  entity_id: string | null
  status: 'open' | 'dismissed' | 'resolved'
  first_seen_at: string
  last_seen_at: string
  notified_at: string | null
}

/** Insert new keys, refresh existing ones, resolve those that cleared. Returns the new rows. */
export async function applyFindings(findings: Finding[]): Promise<{ created: AlertRow[]; resolved: number }> {
  const created: AlertRow[] = []
  const seen = new Set<string>()
  for (const f of findings) {
    if (seen.has(f.key)) continue
    seen.add(f.key)
    const updated = await queryOne<{ id: string }>(
      `UPDATE ads_alerts SET last_seen_at = now(), title = $2, message = $3, severity = $4, data = $5::jsonb
       WHERE dedupe_key = $1 AND status IN ('open', 'dismissed') RETURNING id`,
      [f.key, f.title, f.message, f.severity, JSON.stringify(f.data ?? {})]
    )
    if (updated) continue
    const row = await queryOne<AlertRow>(
      `INSERT INTO ads_alerts (rule, dedupe_key, severity, title, message, entity_type, entity_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (dedupe_key) WHERE status IN ('open', 'dismissed') DO NOTHING
       RETURNING id::text, rule, dedupe_key, severity, title, message, entity_type, entity_id, status, first_seen_at, last_seen_at, notified_at`,
      [f.rule, f.key, f.severity, f.title, f.message, f.entityType ?? null, f.entityId ?? null, JSON.stringify(f.data ?? {})]
    )
    if (row) created.push(row)
  }
  const res = await query(
    `UPDATE ads_alerts SET status = 'resolved', resolved_at = now()
     WHERE status IN ('open', 'dismissed') AND NOT (dedupe_key = ANY($1::text[]))`,
    [[...seen]]
  )
  return { created, resolved: res.rowCount ?? 0 }
}

/** New alerts not notified for the same key in the last 24 hours (a condition that flapped). */
export async function alertsToNotify(created: AlertRow[]): Promise<AlertRow[]> {
  if (!created.length) return []
  const recent = await queryMany<{ dedupe_key: string }>(
    `SELECT DISTINCT dedupe_key FROM ads_alerts
     WHERE dedupe_key = ANY($1::text[]) AND notified_at > now() - interval '24 hours' AND NOT (id = ANY($2::bigint[]))`,
    [created.map(c => c.dedupe_key), created.map(c => c.id)]
  ).catch(() => [])
  const skip = new Set(recent.map(r => r.dedupe_key))
  return created.filter(c => !skip.has(c.dedupe_key))
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

export function renderAlertsEmail(alerts: Pick<AlertRow, 'title' | 'message' | 'severity'>[], brand: string, url: string): { subject: string; html: string } {
  const subject = alerts.length === 1 ? `Google Ads alert: ${alerts[0].title}` : `${alerts.length} new Google Ads alerts`
  const rows = alerts
    .map(
      a => `<tr><td style="width:70px;color:${a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : '#2563eb'};font-weight:600;">${escapeHtml(a.severity)}</td>
        <td><strong>${escapeHtml(a.title)}</strong>${a.message ? `<br><span class="muted">${escapeHtml(a.message)}</span>` : ''}</td></tr>`
    )
    .join('')
  const html = mailShell({
    brand,
    kicker: 'Google Ads alerts',
    title: subject,
    documentTitle: subject,
    content: `<table class="rows">${rows}</table>
      <div class="cta"><a class="button" href="${escapeHtml(url)}">Open Google Ads</a></div>
      <p class="muted">You get these because you can see Google Ads in the store admin. Turn alert emails off under Google Ads &gt; Overview &gt; Alerts.</p>`,
  })
  return { subject, html }
}

export async function notifyAlerts(alerts: AlertRow[]): Promise<{ bell: boolean; emailed: number }> {
  if (!alerts.length) return { bell: false, emailed: 0 }
  const top = alerts.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a))
  await createAdminNotification({
    type: 'google_ads_alert',
    category: 'marketing',
    severity: top.severity,
    title: alerts.length === 1 ? `Google Ads: ${top.title}` : `${alerts.length} new Google Ads alerts`,
    message: alerts.map(a => a.title).slice(0, 5).join(' · '),
    link: '/admin/google-ads?tab=overview',
    entityType: 'ads_alert',
    entityId: `batch-${alerts[0].id}`,
    scope: 'google_ads:read',
  })
  let emailed = 0
  if ((await getNotifySettings()).emails) {
    const { currentBrandNameAsync } = await import('@/lib/catalog/brand')
    const { briefingFromAsync } = await import('@/lib/shared/daily-briefing')
    const { subject, html } = renderAlertsEmail(alerts, await currentBrandNameAsync(), await adsConsoleUrl('overview'))
    const from = await briefingFromAsync()
    for (const to of await adsRecipients()) {
      try {
        await sendAuditedMail({ from, to, subject, html, kind: 'google_ads_alert', entityType: 'ads_alert', entityId: alerts[0].id })
        emailed++
      } catch (e) {
        console.error('[google-ads] alert email failed', e)
      }
    }
  }
  await query(`UPDATE ads_alerts SET notified_at = now() WHERE id = ANY($1::bigint[])`, [alerts.map(a => a.id)])
  return { bell: true, emailed }
}

export interface AlertRunResult {
  findings: number
  created: number
  resolved: number
  notified: number
}

/** Evaluate, store and notify. Never throws: alerts must not fail a sync. */
export async function runAdsAlerts(now = new Date()): Promise<AlertRunResult | { error: string }> {
  try {
    const cfg = await getAlertConfig()
    const findings = evaluateRules(await loadSnapshot(cfg, now), cfg)
    const { created, resolved } = await applyFindings(findings)
    const toNotify = await alertsToNotify(created)
    await notifyAlerts(toNotify)
    return { findings: findings.length, created: created.length, resolved, notified: toNotify.length }
  } catch (e: any) {
    console.error('[google-ads] alerts failed', e)
    return { error: String(e?.message ?? e).slice(0, 300) }
  }
}

export async function listAlerts(): Promise<AlertRow[]> {
  return queryMany<AlertRow>(
    `SELECT id::text, rule, dedupe_key, severity, title, message, entity_type, entity_id, status, first_seen_at, last_seen_at, notified_at
     FROM ads_alerts WHERE status IN ('open', 'dismissed')
     ORDER BY (status = 'open') DESC, CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 100`
  ).catch(() => [])
}

export async function dismissAlert(id: string, by: string | null): Promise<boolean> {
  const r = await query(
    `UPDATE ads_alerts SET status = 'dismissed', dismissed_at = now(), dismissed_by = $2 WHERE id = $1::bigint AND status = 'open'`,
    [id, by]
  )
  return (r.rowCount ?? 0) > 0
}
