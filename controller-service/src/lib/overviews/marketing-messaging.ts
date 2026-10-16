import type { AttentionItem } from '@/components/admin/overview/kit'
import type { Bucket } from '@/lib/overview/period'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, bucketsCte, inBucket, num, periodCase, str } from './marketing'

// Broadcast messages (email_campaigns -> email_campaign_logs, one row per recipient and channel;
// messaging-service flips a row to failed with the provider reason, e.g. 63049) plus every
// outbound WhatsApp/SMS in message_logs, which carries the provider price.

const CAP = `(l.error ILIKE '%63049%' OR l.error ILIKE '%caps marketing messages%')`
const ML_FAILED = `(ml.status = 'failed' OR ml.delivery_status IN ('failed', 'undelivered'))`

export const KPI_SQL = `
WITH ${BOUNDS},
l AS (
  SELECT ecl.*, ${periodCase('ecl.sent_at')} AS period
    FROM email_campaign_logs ecl, b
   WHERE ecl.sent_at >= b.p0 AND ecl.sent_at < b.c1
),
ml AS (
  SELECT m.*, ${periodCase('m.sent_at')} AS period
    FROM message_logs m, b
   WHERE m.sent_at >= b.p0 AND m.sent_at < b.c1 AND COALESCE(m.direction, 'outbound') = 'outbound'
)
SELECT p.period,
       (SELECT COUNT(*) FROM l WHERE l.period = p.period) AS broadcast_messages,
       (SELECT COUNT(*) FROM l WHERE l.period = p.period AND l.status = 'failed') AS broadcast_failed,
       (SELECT COUNT(*) FROM l WHERE l.period = p.period AND l.status = 'failed' AND ${CAP}) AS wa_cap,
       (SELECT COUNT(*) FROM l WHERE l.period = p.period AND COALESCE(l.channel, 'email') = 'email') AS emails,
       (SELECT COUNT(DISTINCT l.campaign_id) FROM l WHERE l.period = p.period) AS broadcasts,
       (SELECT COUNT(*) FROM ml WHERE ml.period = p.period) AS logged_messages,
       (SELECT COUNT(*) FROM ml WHERE ml.period = p.period AND ${ML_FAILED}) AS logged_failed,
       (SELECT COUNT(*) FROM ml WHERE ml.period = p.period AND ml.channel = 'whatsapp') AS whatsapp,
       (SELECT COUNT(*) FROM ml WHERE ml.period = p.period AND ml.channel = 'sms') AS sms,
       (SELECT COALESCE(SUM(ml.price), 0) FROM ml WHERE ml.period = p.period) AS spend,
       (SELECT COUNT(*) FROM ml WHERE ml.period = p.period AND ml.price IS NOT NULL) AS priced
  FROM (VALUES ('cur'), ('prev')) p(period)
`

/** Messages by channel and outcome in the current period, from both sources. */
export const BY_CHANNEL_SQL = `
WITH ${BOUNDS}
SELECT 'broadcast' AS source, COALESCE(l.channel, 'email') AS channel, l.status AS outcome, COUNT(*) AS n, 0 AS spend
  FROM email_campaign_logs l, b
 WHERE l.sent_at >= b.c0 AND l.sent_at < b.c1
 GROUP BY 1, 2, 3
UNION ALL
SELECT 'automated', ml.channel,
       CASE WHEN ${ML_FAILED} THEN 'failed' WHEN ml.delivery_status IN ('delivered', 'read') THEN 'delivered' ELSE 'sent' END,
       COUNT(*), COALESCE(SUM(ml.price), 0)
  FROM message_logs ml, b
 WHERE ml.sent_at >= b.c0 AND ml.sent_at < b.c1 AND COALESCE(ml.direction, 'outbound') = 'outbound'
 GROUP BY 1, 2, 3
`

export const FAILURES_SQL = `
WITH ${BOUNDS}
SELECT COALESCE(l.channel, 'email') AS channel, l.error, COUNT(*) AS n
  FROM email_campaign_logs l, b
 WHERE l.sent_at >= b.c0 AND l.sent_at < b.c1 AND l.status = 'failed'
 GROUP BY 1, 2
UNION ALL
SELECT ml.channel, COALESCE(NULLIF(ml.error, ''), ml.delivery_status), COUNT(*)
  FROM message_logs ml, b
 WHERE ml.sent_at >= b.c0 AND ml.sent_at < b.c1 AND ${ML_FAILED}
 GROUP BY 1, 2
`

export const seriesSql = (bucket: Bucket) => `
WITH ${BOUNDS}, ${bucketsCte(bucket)},
m AS (
  SELECT sent_at, COALESCE(channel, 'email') AS channel, status = 'failed' AS failed FROM email_campaign_logs, b
   WHERE sent_at >= b.c0 AND sent_at < b.c1
  UNION ALL
  SELECT ml.sent_at, ml.channel, ${ML_FAILED} FROM message_logs ml, b
   WHERE ml.sent_at >= b.c0 AND ml.sent_at < b.c1 AND COALESCE(ml.direction, 'outbound') = 'outbound'
)
SELECT to_char(k.bucket, 'YYYY-MM-DD') AS label,
       COUNT(m.sent_at) FILTER (WHERE m.channel = 'email') AS email,
       COUNT(m.sent_at) FILTER (WHERE m.channel = 'whatsapp') AS whatsapp,
       COUNT(m.sent_at) FILTER (WHERE m.channel = 'sms') AS sms,
       COUNT(m.sent_at) FILTER (WHERE m.failed) AS failed
  FROM k LEFT JOIN m ON ${inBucket('m.sent_at', bucket)}
 GROUP BY k.bucket ORDER BY k.bucket
`

/** Broadcasts sent in the period with their delivery outcome. */
export const BROADCASTS_SQL = `
WITH ${BOUNDS}
SELECT c.id, c.title, c.template_key, c.channels, c.status, c.sent_at, c.recipient_count,
       COUNT(l.id) AS messages,
       COUNT(l.id) FILTER (WHERE l.status = 'failed') AS failed,
       COUNT(l.id) FILTER (WHERE l.status = 'failed' AND ${CAP}) AS wa_cap
  FROM email_campaigns c LEFT JOIN email_campaign_logs l ON l.campaign_id = c.id, b
 WHERE c.sent_at >= b.c0 AND c.sent_at < b.c1
 GROUP BY c.id ORDER BY c.sent_at DESC LIMIT 10
`

/** Templates behind automated WhatsApp/SMS (message_logs.kind) in the period. */
export const TEMPLATES_SQL = `
WITH ${BOUNDS}
SELECT ml.kind, ml.channel, COUNT(*) AS n,
       COUNT(*) FILTER (WHERE ${ML_FAILED}) AS failed,
       COALESCE(SUM(ml.price), 0) AS spend
  FROM message_logs ml, b
 WHERE ml.sent_at >= b.c0 AND ml.sent_at < b.c1 AND COALESCE(ml.direction, 'outbound') = 'outbound' AND ml.kind IS NOT NULL
 GROUP BY 1, 2 ORDER BY n DESC LIMIT 10
`

export const STATE_SQL = `
SELECT COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > NOW()) AS scheduled,
       COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at <= NOW() - INTERVAL '15 minutes') AS overdue,
       COUNT(*) FILTER (WHERE status = 'sending' AND COALESCE(sent_at, updated_at, created_at) < NOW() - INTERVAL '1 hour') AS stuck,
       COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
       MIN(scheduled_at) FILTER (WHERE status = 'scheduled' AND scheduled_at > NOW()) AS next_scheduled
  FROM email_campaigns
`

export interface MessagingTotals {
  broadcast_messages: number
  broadcast_failed: number
  wa_cap: number
  emails: number
  broadcasts: number
  logged_messages: number
  logged_failed: number
  whatsapp: number
  sms: number
  spend: number
  priced: number
  messages: number
  failed: number
  failure_rate: number | null
}

export function toMessagingTotals(r: Record<string, unknown> | undefined): MessagingTotals {
  const t = {
    broadcast_messages: num(r?.broadcast_messages),
    broadcast_failed: num(r?.broadcast_failed),
    wa_cap: num(r?.wa_cap),
    emails: num(r?.emails),
    broadcasts: num(r?.broadcasts),
    logged_messages: num(r?.logged_messages),
    logged_failed: num(r?.logged_failed),
    whatsapp: num(r?.whatsapp),
    sms: num(r?.sms),
    spend: num(r?.spend),
    priced: num(r?.priced),
  }
  const messages = t.broadcast_messages + t.logged_messages
  const failed = t.broadcast_failed + t.logged_failed
  return { ...t, messages, failed, failure_rate: ratio(failed, messages) }
}

/** Pivot `{source, channel, outcome, n, spend}` rows into one row per channel. */
export function channelMatrix(rows: Record<string, unknown>[]) {
  const m = new Map<string, { channel: string; sent: number; delivered: number; failed: number; spend: number }>()
  for (const r of rows) {
    const ch = str(r.channel) || 'email'
    const cur = m.get(ch) ?? { channel: ch, sent: 0, delivered: 0, failed: 0, spend: 0 }
    const n = num(r.n)
    const o = str(r.outcome)
    if (o === 'failed') cur.failed += n
    else if (o === 'delivered') cur.delivered += n
    else cur.sent += n
    cur.spend += num(r.spend)
    m.set(ch, cur)
  }
  return [...m.values()].map(x => ({ ...x, total: x.sent + x.delivered + x.failed })).sort((a, b) => b.total - a.total)
}

export interface MessagingState {
  scheduled: number
  overdue: number
  stuck: number
  drafts: number
  next_scheduled: unknown
}

export const toMessagingState = (r: Record<string, unknown> | undefined): MessagingState => ({
  scheduled: num(r?.scheduled),
  overdue: num(r?.overdue),
  stuck: num(r?.stuck),
  drafts: num(r?.drafts),
  next_scheduled: r?.next_scheduled ?? null,
})

export const HIGH_FAILURE_RATE = 0.1

export function messagingAttention(
  cur: MessagingTotals,
  state: MessagingState,
  failures: { key: string; label: string; count: number }[]
): AttentionItem[] {
  const out: AttentionItem[] = []
  const list = '/admin/marketing/messaging?tab=list'
  if (state.stuck)
    out.push({
      key: 'stuck',
      severity: 'critical',
      title: `${state.stuck} broadcast${state.stuck === 1 ? ' has' : 's have'} been sending for over an hour`,
      href: list,
    })
  if (state.overdue)
    out.push({
      key: 'overdue',
      severity: 'warning',
      title: `${state.overdue} scheduled broadcast${state.overdue === 1 ? ' is' : 's are'} past the send time`,
      href: list,
    })
  const cap = failures.find(f => f.key === '63049')
  if (cap)
    out.push({
      key: 'wa_cap',
      severity: 'warning',
      title: `${cap.count} WhatsApp message${cap.count === 1 ? ' was' : 's were'} held back by Meta's marketing cap (63049)`,
      sub: "Meta caps marketing messages to people who haven't chatted with you recently. They were not billed; send these customers email or SMS instead.",
    })
  if (cur.failure_rate != null && cur.failure_rate > HIGH_FAILURE_RATE && cur.failed >= 5) {
    const top = failures.filter(f => f.key !== '63049')[0]
    out.push({
      key: 'failure_rate',
      severity: 'warning',
      title: `${(cur.failure_rate * 100).toFixed(1)}% of messages failed`,
      sub: top ? `Most common: ${top.label}` : undefined,
    })
  }
  if (state.drafts)
    out.push({
      key: 'drafts',
      severity: 'info',
      title: `${state.drafts} draft broadcast${state.drafts === 1 ? '' : 's'} not sent`,
      href: list,
    })
  return out
}
