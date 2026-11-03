import { queryMany, queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { escapeHtml, mailShell } from '@/lib/shared/mail-template'
import { computeReturnMetrics, googleAdsOrderStats, type ReturnMetrics } from './attribution'
import { listAlerts } from './alerts'
import { SETTING, adsConsoleUrl, adsRecipients, flag, readSetting } from './notify'
import { dateInZone } from './sync'
import type { DateRange } from './queries'

// Weekly Google Ads digest: the last 7 complete days against the 7 before, with revenue and
// profit from our own orders, best and worst campaigns, search terms that cost money without a
// conversion, and open alerts. Sent per store on Mondays (fan-out) and on demand.

export interface PeriodTotals {
  cost: number
  clicks: number
  conversions: number
  value: number
  orders: number
  revenue: number
  returns: ReturnMetrics
}

export interface DigestCampaign {
  name: string
  cost: number
  conversions: number
  value: number
  roas: number | null
}

export interface DigestData {
  range: DateRange
  previous: DateRange
  currency: string
  current: PeriodTotals
  prior: PeriodTotals
  attribution: boolean
  top: DigestCampaign[]
  worst: DigestCampaign[]
  wasted: { term: string; cost: number; clicks: number }[]
  alerts: { title: string; severity: string }[]
}

export function digestRanges(today: string): { range: DateRange; previous: DateRange } {
  const d = (offset: number) => {
    const x = new Date(`${today}T00:00:00Z`)
    x.setUTCDate(x.getUTCDate() - offset)
    return x.toISOString().slice(0, 10)
  }
  return { range: { from: d(7), to: d(1) }, previous: { from: d(14), to: d(8) } }
}

const n = (v: unknown) => Number(v ?? 0) || 0

async function totals(r: DateRange, tz: string): Promise<PeriodTotals & { available: boolean }> {
  const [m, stats] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(cost_micros),0) AS cost_micros, COALESCE(SUM(clicks),0) AS clicks,
              COALESCE(SUM(conversions),0) AS conversions, COALESCE(SUM(conversions_value),0) AS value
       FROM ads_daily_metrics WHERE ad_group_id = 0 AND date BETWEEN $1 AND $2`,
      [r.from, r.to]
    ),
    googleAdsOrderStats(r, tz),
  ])
  const cost = n(m?.cost_micros) / 1e6
  return {
    cost,
    clicks: n(m?.clicks),
    conversions: n(m?.conversions),
    value: n(m?.value),
    orders: stats.orders,
    revenue: stats.revenue,
    returns: computeReturnMetrics(cost, stats),
    available: stats.available,
  }
}

/** Best by Google ROAS among campaigns that converted; worst by spend with the lowest ROAS. */
export function rankCampaigns(rows: DigestCampaign[]): { top: DigestCampaign[]; worst: DigestCampaign[] } {
  const spent = rows.filter(r => r.cost > 0)
  const top = spent.filter(r => r.conversions > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0) || b.value - a.value).slice(0, 3)
  const topNames = new Set(top.map(t => t.name))
  const worst = spent
    .filter(r => !topNames.has(r.name))
    .sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0) || b.cost - a.cost)
    .slice(0, 3)
  return { top, worst }
}

export async function collectDigest(now = new Date()): Promise<DigestData> {
  const acc = await queryOne<{ time_zone: string | null; currency_code: string | null }>(`SELECT time_zone, currency_code FROM ads_account WHERE id = 1`).catch(() => null)
  const tz = acc?.time_zone || 'Asia/Kolkata'
  const { range, previous } = digestRanges(dateInZone(now, tz))
  const [current, prior, campaigns, wasted, alerts] = await Promise.all([
    totals(range, tz),
    totals(previous, tz),
    queryMany(
      `SELECT c.name, COALESCE(SUM(m.cost_micros),0) AS cost_micros, COALESCE(SUM(m.conversions),0) AS conversions,
              COALESCE(SUM(m.conversions_value),0) AS value
       FROM ads_campaigns c JOIN ads_daily_metrics m ON m.campaign_id = c.campaign_id AND m.ad_group_id = 0 AND m.date BETWEEN $1 AND $2
       GROUP BY c.campaign_id, c.name`,
      [range.from, range.to]
    ),
    queryMany(
      `SELECT search_term, SUM(cost_micros) AS cost_micros, SUM(clicks) AS clicks FROM ads_search_terms
       WHERE date BETWEEN $1 AND $2 GROUP BY search_term
       HAVING SUM(conversions) = 0 AND SUM(cost_micros) > 0 ORDER BY 2 DESC LIMIT 8`,
      [range.from, range.to]
    ),
    listAlerts(),
  ])
  const rows: DigestCampaign[] = campaigns.map((r: any) => {
    const cost = n(r.cost_micros) / 1e6
    return { name: r.name, cost, conversions: n(r.conversions), value: n(r.value), roas: cost > 0 ? n(r.value) / cost : null }
  })
  return {
    range,
    previous,
    currency: acc?.currency_code || 'INR',
    current,
    prior,
    attribution: current.available,
    ...rankCampaigns(rows),
    wasted: wasted.map((w: any) => ({ term: w.search_term, cost: n(w.cost_micros) / 1e6, clicks: n(w.clicks) })),
    alerts: alerts.filter(a => a.status === 'open').map(a => ({ title: a.title, severity: a.severity })),
  }
}

const fmt = (v: number | null, c: string) => (v == null ? '-' : `${c === 'INR' ? '₹' : `${c} `}${Math.round(v).toLocaleString('en-IN')}`)
const x = (v: number | null) => (v == null ? '-' : `${v.toFixed(2)}x`)

function delta(cur: number | null, prev: number | null, lowerIsBetter = false): string {
  if (cur == null || prev == null || prev === 0) return ''
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100)
  if (pct === 0) return ''
  const good = lowerIsBetter ? pct < 0 : pct > 0
  return ` <span style="color:${good ? '#16a34a' : '#dc2626'};font-size:12px;">${pct > 0 ? '+' : ''}${pct}%</span>`
}

export function renderDigest(d: DigestData, brand: string, url: string): { subject: string; html: string } {
  const c = d.currency
  const cur = d.current
  const pre = d.prior
  const subject = `Google Ads week ${d.range.from} to ${d.range.to}: ${fmt(cur.cost, c)} spent${d.attribution ? `, true ROAS ${x(cur.returns.trueRoas)}` : ''}`
  const kpi = (label: string, value: string, change = '') => `<tr><td class="info-label">${label}</td><td style="text-align:right;">${value}${change}</td></tr>`
  const campaignRows = (list: DigestCampaign[]) =>
    list.length
      ? list.map(r => `<tr><td>${escapeHtml(r.name)}</td><td style="text-align:right;">${fmt(r.cost, c)}</td><td style="text-align:right;">${r.conversions.toFixed(1)}</td><td style="text-align:right;">${x(r.roas)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">None this week.</td></tr>'
  const head = '<tr><th>Campaign</th><th style="text-align:right;">Spend</th><th style="text-align:right;">Conv.</th><th style="text-align:right;">ROAS</th></tr>'
  const content = `
    <p class="muted">${d.range.from} to ${d.range.to}, compared with ${d.previous.from} to ${d.previous.to}.</p>
    <table class="rows">
      ${kpi('Spend', fmt(cur.cost, c), delta(cur.cost, pre.cost, true))}
      ${kpi('Clicks', cur.clicks.toLocaleString('en-IN'), delta(cur.clicks, pre.clicks))}
      ${kpi('Conversions (Google)', cur.conversions.toFixed(1), delta(cur.conversions, pre.conversions))}
      ${
        d.attribution
          ? `${kpi('Orders from Google Ads', String(cur.orders), delta(cur.orders, pre.orders))}
      ${kpi('Revenue from our orders', fmt(cur.returns.netRevenue, c), delta(cur.returns.netRevenue, pre.returns.netRevenue))}
      ${kpi('True ROAS', x(cur.returns.trueRoas), delta(cur.returns.trueRoas, pre.returns.trueRoas))}
      ${kpi('POAS', x(cur.returns.poas), delta(cur.returns.poas, pre.returns.poas))}
      ${kpi('Profit after ads', fmt(cur.returns.profitAfterAds, c), delta(cur.returns.profitAfterAds, pre.returns.profitAfterAds))}`
          : kpi('Revenue from our orders', 'click tracking not available on this store')
      }
    </table>
    <h3>Best campaigns</h3>
    <table class="rows">${head}${campaignRows(d.top)}</table>
    <h3>Worst campaigns</h3>
    <table class="rows">${head}${campaignRows(d.worst)}</table>
    <h3>Search terms that cost money without a conversion</h3>
    ${
      d.wasted.length
        ? `<table class="rows"><tr><th>Search term</th><th style="text-align:right;">Spend</th><th style="text-align:right;">Clicks</th></tr>${d.wasted
            .map(w => `<tr><td>${escapeHtml(w.term)}</td><td style="text-align:right;">${fmt(w.cost, c)}</td><td style="text-align:right;">${w.clicks}</td></tr>`)
            .join('')}</table><p class="muted">Candidates for negative keywords (Keywords &amp; search terms tab).</p>`
        : '<p class="muted">None this week.</p>'
    }
    <h3>Open alerts</h3>
    ${d.alerts.length ? `<ul>${d.alerts.slice(0, 10).map(a => `<li>${escapeHtml(a.title)}</li>`).join('')}</ul>` : '<p class="muted">No open alerts.</p>'}
    <div class="cta"><a class="button" href="${escapeHtml(url)}">Open Google Ads</a></div>
    <p class="muted">True ROAS and POAS use your own paid orders that came from a Google Ads click, less refunds and cost prices. Turn this email off under Google Ads &gt; Overview &gt; Alerts.</p>`
  return { subject, html: mailShell({ brand, kicker: 'Weekly Google Ads digest', title: 'Your week in Google Ads', documentTitle: subject, content }) }
}

export interface DigestSendResult {
  status: 'sent' | 'skipped'
  reason?: 'disabled' | 'already_sent' | 'no_recipients' | 'no_activity'
  sent: number
  failed: number
}

/** Claims the week for this store; false when it was already sent (a restart re-firing the job). */
async function claimPeriod(period: string): Promise<boolean> {
  const row = await queryOne<{ key: string }>(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE site_settings.value IS DISTINCT FROM EXCLUDED.value
     RETURNING key`,
    [SETTING.digestPeriod, period]
  )
  return !!row
}

export async function sendWeeklyDigest(opts: { to?: string[]; force?: boolean; now?: Date } = {}): Promise<DigestSendResult> {
  // On demand (explicit recipients or force) ignores the opt-out and the once-a-week guard.
  const scheduled = !opts.to && !opts.force
  if (scheduled && !flag(await readSetting(SETTING.digest), true)) return { status: 'skipped', reason: 'disabled', sent: 0, failed: 0 }
  const data = await collectDigest(opts.now)
  if (scheduled && data.current.cost === 0 && data.prior.cost === 0) return { status: 'skipped', reason: 'no_activity', sent: 0, failed: 0 }
  const recipients = opts.to ?? (await adsRecipients())
  if (!recipients.length) return { status: 'skipped', reason: 'no_recipients', sent: 0, failed: 0 }
  if (scheduled && !(await claimPeriod(data.range.from))) return { status: 'skipped', reason: 'already_sent', sent: 0, failed: 0 }
  const { currentBrandNameAsync } = await import('@/lib/catalog/brand')
  const { briefingFromAsync } = await import('@/lib/shared/daily-briefing')
  const { subject, html } = renderDigest(data, await currentBrandNameAsync(), await adsConsoleUrl('overview'))
  const from = await briefingFromAsync()
  let sent = 0
  let failed = 0
  for (const to of recipients) {
    try {
      await sendAuditedMail({ from, to, subject, html, kind: 'google_ads_digest', metadata: { from: data.range.from, to: data.range.to } })
      sent++
    } catch (e) {
      console.error('[google-ads] digest email failed', e)
      failed++
    }
  }
  return { status: 'sent', sent, failed }
}
