import type { AttentionItem } from '@/lib/overview/attention'
import type { Bucket } from '@/lib/overview/period'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, bucketsCte, inBucket, num, periodCase, realized, str } from './marketing'

// Automated campaigns. Sends are email_campaigns_sent rows by sent_at; a conversion is the order
// attributeConversion() links to a clicked send (7-day window), counted when realized. UTM revenue is
// realized orders whose utm_medium/utm_source is a messaging channel.

const UTM_CHANNEL = `(lower(o.utm_medium) IN ('email', 'sms', 'whatsapp') OR lower(o.utm_source) IN ('email', 'sms', 'whatsapp'))`

const SENT_COLS = `
       COUNT(*) AS sends,
       COUNT(*) FILTER (WHERE s.channel = 'email') AS emails,
       COUNT(*) FILTER (WHERE s.channel <> 'email') AS other_channels,
       COUNT(*) FILTER (WHERE s.channel = 'email' AND s.bounced_at IS NULL) AS delivered_emails,
       COUNT(s.opened_at) AS opened,
       COUNT(s.clicked_at) AS clicked,
       COUNT(s.converted_at) AS converted,
       COUNT(s.unsubscribed_at) AS unsubscribed,
       COUNT(s.bounced_at) AS bounced,
       COUNT(s.complained_at) AS complained,
       COALESCE(SUM(o.total_amount) FILTER (WHERE ${realized('o')}), 0) AS revenue`

export const KPI_SQL = `
WITH ${BOUNDS},
s AS (
  SELECT ecs.*, ${periodCase('ecs.sent_at')} AS period
    FROM email_campaigns_sent ecs, b
   WHERE ecs.sent_at >= b.p0 AND ecs.sent_at < b.c1 AND ecs.campaign_kind <> 'broadcast'
)
SELECT p.period, x.*,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE ${realized('o')} AND ${UTM_CHANNEL}
          AND o.created_at >= (CASE WHEN p.period = 'cur' THEN b.c0 ELSE b.p0 END)
          AND o.created_at < (CASE WHEN p.period = 'cur' THEN b.c1 ELSE b.c0 END)) AS utm_revenue,
       (SELECT COUNT(*) FROM orders o WHERE ${realized('o')} AND ${UTM_CHANNEL}
          AND o.created_at >= (CASE WHEN p.period = 'cur' THEN b.c0 ELSE b.p0 END)
          AND o.created_at < (CASE WHEN p.period = 'cur' THEN b.c1 ELSE b.c0 END)) AS utm_orders
  FROM (VALUES ('cur'), ('prev')) p(period) CROSS JOIN b
  CROSS JOIN LATERAL (
    SELECT ${SENT_COLS}
      FROM s LEFT JOIN orders o ON o.id = s.conversion_order_id
     WHERE s.period = p.period
  ) x
`

export const seriesSql = (bucket: Bucket) => `
WITH ${BOUNDS}, ${bucketsCte(bucket)}
SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
       COUNT(s.id) AS sends, COUNT(s.opened_at) AS opened, COUNT(s.clicked_at) AS clicked, COUNT(s.converted_at) AS converted
  FROM k CROSS JOIN b
  LEFT JOIN email_campaigns_sent s ON s.sent_at >= b.c0 AND s.sent_at < b.c1 AND s.campaign_kind <> 'broadcast'
        AND ${inBucket('s.sent_at', bucket)}
 GROUP BY k.bucket ORDER BY k.bucket
`

export const BY_CAMPAIGN_SQL = `
WITH ${BOUNDS}
SELECT s.campaign_kind AS kind, COALESCE(c.name, s.campaign_kind) AS name, c.enabled, ${SENT_COLS}
  FROM email_campaigns_sent s
  LEFT JOIN campaigns c ON c.kind = s.campaign_kind
  LEFT JOIN orders o ON o.id = s.conversion_order_id, b
 WHERE s.sent_at >= b.c0 AND s.sent_at < b.c1 AND s.campaign_kind <> 'broadcast'
 GROUP BY s.campaign_kind, c.name, c.enabled
 ORDER BY sends DESC LIMIT 25
`

export const BY_CHANNEL_SQL = `
WITH ${BOUNDS}
SELECT COALESCE(s.channel, 'email') AS channel, ${SENT_COLS}
  FROM email_campaigns_sent s LEFT JOIN orders o ON o.id = s.conversion_order_id, b
 WHERE s.sent_at >= b.c0 AND s.sent_at < b.c1 AND s.campaign_kind <> 'broadcast'
 GROUP BY 1 ORDER BY sends DESC
`

/** WhatsApp/SMS sends for campaigns that failed at the provider, by campaign and error. */
export const FAILURES_SQL = `
WITH ${BOUNDS}
SELECT ml.kind, ml.channel, COALESCE(NULLIF(ml.error, ''), ml.delivery_status) AS error, COUNT(*) AS n
  FROM message_logs ml, b
 WHERE ml.entity_type = 'campaign' AND ml.sent_at >= b.c0 AND ml.sent_at < b.c1
   AND (ml.status = 'failed' OR ml.delivery_status IN ('failed', 'undelivered'))
 GROUP BY 1, 2, 3
`

/** Enabled campaigns that sent nothing in the period. */
export const IDLE_SQL = `
WITH ${BOUNDS}
SELECT c.kind, c.name, c.last_run_at
  FROM campaigns c, b
 WHERE c.enabled AND c.kind <> 'broadcast'
   AND NOT EXISTS (SELECT 1 FROM email_campaigns_sent s WHERE s.campaign_kind = c.kind AND s.sent_at >= b.c0 AND s.sent_at < b.c1)
 ORDER BY c.last_run_at NULLS FIRST LIMIT 20
`

export const COUNTS_SQL = `
SELECT COUNT(*) FILTER (WHERE enabled) AS enabled, COUNT(*) AS total FROM campaigns WHERE kind <> 'broadcast'
`

export interface CampaignStats {
  sends: number
  emails: number
  other_channels: number
  delivered_emails: number
  opened: number
  clicked: number
  converted: number
  unsubscribed: number
  bounced: number
  complained: number
  revenue: number
  open_rate: number | null
  click_rate: number | null
  conversion_rate: number | null
  unsubscribe_rate: number | null
  bounce_rate: number | null
}

/** Rates over delivered emails (opens and clicks are only tracked for email). */
export function toCampaignStats(r: Record<string, unknown> | undefined): CampaignStats {
  const t = {
    sends: num(r?.sends),
    emails: num(r?.emails),
    other_channels: num(r?.other_channels),
    delivered_emails: num(r?.delivered_emails),
    opened: num(r?.opened),
    clicked: num(r?.clicked),
    converted: num(r?.converted),
    unsubscribed: num(r?.unsubscribed),
    bounced: num(r?.bounced),
    complained: num(r?.complained),
    revenue: num(r?.revenue),
  }
  return {
    ...t,
    open_rate: ratio(t.opened, t.delivered_emails),
    click_rate: ratio(t.clicked, t.delivered_emails),
    conversion_rate: ratio(t.converted, t.sends),
    unsubscribe_rate: ratio(t.unsubscribed, t.delivered_emails),
    bounce_rate: ratio(t.bounced, t.emails),
  }
}

export type CampaignTotals = CampaignStats & { utm_revenue: number; utm_orders: number }

export const toCampaignTotals = (r: Record<string, unknown> | undefined): CampaignTotals => ({
  ...toCampaignStats(r),
  utm_revenue: num(r?.utm_revenue),
  utm_orders: num(r?.utm_orders),
})

export const HIGH_UNSUBSCRIBE = 0.02
export const HIGH_BOUNCE = 0.05
const MIN_SAMPLE = 50

export interface CampaignRowStats extends CampaignStats {
  kind: string
  name: string
  enabled: boolean | null
}

export const toCampaignRow = (r: Record<string, unknown>): CampaignRowStats => ({
  kind: str(r.kind),
  name: str(r.name),
  enabled: r.enabled == null ? null : !!r.enabled,
  ...toCampaignStats(r),
})

export function campaignAttention(
  rows: CampaignRowStats[],
  idle: { kind: string; name: string; last_run_at: unknown }[],
  failures: { key: string; label: string; count: number }[]
): AttentionItem[] {
  const out: AttentionItem[] = []
  const cap = failures.find(f => f.key === '63049')
  if (cap)
    out.push({
      key: 'wa_cap',
      severity: 'warning',
      title: `${cap.count} WhatsApp campaign message${cap.count === 1 ? ' was' : 's were'} held back by Meta's marketing cap (63049)`,
      sub: "Meta limits marketing messages to people who haven't chatted with you recently; these were not billed. Email reaches them instead.",
    })
  const otherFailed = failures.filter(f => f.key !== '63049').reduce((s, f) => s + f.count, 0)
  if (otherFailed)
    out.push({
      key: 'failed',
      severity: 'warning',
      title: `${otherFailed} campaign WhatsApp/SMS send${otherFailed === 1 ? '' : 's'} failed`,
      sub: failures
        .filter(f => f.key !== '63049')
        .slice(0, 2)
        .map(f => f.label)
        .join(', '),
    })
  for (const r of rows) {
    if (r.emails >= MIN_SAMPLE && r.unsubscribe_rate != null && r.unsubscribe_rate > HIGH_UNSUBSCRIBE)
      out.push({
        key: `unsub_${r.kind}`,
        severity: 'warning',
        title: `${r.name}: ${(r.unsubscribe_rate * 100).toFixed(1)}% unsubscribed`,
        sub: 'Check the frequency and the message.',
        href: `/admin/campaigns/${r.kind}`,
      })
    if (r.emails >= MIN_SAMPLE && r.bounce_rate != null && r.bounce_rate > HIGH_BOUNCE)
      out.push({
        key: `bounce_${r.kind}`,
        severity: 'critical',
        title: `${r.name}: ${(r.bounce_rate * 100).toFixed(1)}% bounced`,
        sub: 'High bounces hurt sender reputation for every email.',
        href: `/admin/campaigns/${r.kind}`,
      })
  }
  if (idle.length)
    out.push({
      key: 'idle',
      severity: 'info',
      title: `${idle.length} enabled campaign${idle.length === 1 ? '' : 's'} sent nothing this period`,
      sub:
        idle
          .slice(0, 3)
          .map(i => i.name)
          .join(', ') + (idle.length > 3 ? ` and ${idle.length - 3} more` : ''),
      href: idle.length === 1 ? `/admin/campaigns/${idle[0].kind}` : '/admin/campaigns?tab=list',
    })
  return out
}
