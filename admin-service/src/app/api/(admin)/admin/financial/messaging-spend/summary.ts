import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { fillSeries } from '@admin/app/(admin)/admin/financial/_components/overview-period'
import { MESSAGING_ESTIMATE_INR } from '@/lib/shared/messaging/pricing'

// Finance → Messaging. SMS/WhatsApp are trued up to the provider price on the status callback;
// unknown prices fall back to the per-channel estimate. Bounced sends cost nothing. Email has no
// delivery callback so it is always the estimate.

const IST = `'Asia/Kolkata'`
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

const SMS_WA_COST = `COALESCE(price,
  CASE
    WHEN delivery_status IN ('failed','undelivered') THEN 0
    WHEN channel = 'sms' THEN ${MESSAGING_ESTIMATE_INR.sms}::numeric
    ELSE ${MESSAGING_ESTIMATE_INR.whatsapp}::numeric
  END)`

const EMAIL_COST = `CASE WHEN status = 'sent' THEN ${MESSAGING_ESTIMATE_INR.email}::numeric ELSE 0 END`

const inRange = (col: string) =>
  `${col} >= ($1::date::timestamp AT TIME ZONE ${IST}) AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE ${IST})`

// Direction classifier: campaigns → marketing, coupon/offer kinds → promo, else transactional.
const DIR_EXPR = (kindCol: string, entityCol: string) =>
  `CASE
    WHEN ${kindCol} ILIKE 'campaign%' OR ${kindCol} ILIKE 'newsletter%' OR ${entityCol} = 'campaign' THEN 'marketing'
    WHEN ${kindCol} ILIKE 'coupon%' OR ${kindCol} ILIKE 'offer%' OR ${kindCol} ILIKE 'promo%' OR ${kindCol} ILIKE 'discount%' THEN 'promo'
    ELSE 'txn'
  END`

export type ChannelKey = 'sms' | 'whatsapp' | 'email'
export const CHANNEL_KEYS: readonly ChannelKey[] = ['sms', 'whatsapp', 'email']

export type DirectionKey = 'txn' | 'promo' | 'marketing'
export const DIRECTION_KEYS: readonly DirectionKey[] = ['txn', 'promo', 'marketing']

export interface MessagingTotals {
  total: number
  sms: number
  whatsapp: number
  email: number
  sends: number
  failed: number
}

export interface ByChannelRow {
  key: ChannelKey
  sends: number
  failed: number
  spent: number
}

export interface ByDirectionRow {
  key: DirectionKey
  sends: number
  spent: number
}

export interface ByTemplateRow {
  slug: string
  channel: ChannelKey
  sends: number
  spent: number
}

export interface ByCampaignRow {
  id: string
  name: string
  channel: ChannelKey
  sends: number
  spent: number
}

export interface TopRecipientRow {
  to: string
  channel: ChannelKey
  sends: number
  spent: number
}

async function totals(p: Period): Promise<MessagingTotals> {
  const [smsWa, email] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT COUNT(*) AS sends,
         COALESCE(SUM(${SMS_WA_COST}) FILTER (WHERE channel = 'sms'), 0) AS sms,
         COALESCE(SUM(${SMS_WA_COST}) FILTER (WHERE channel = 'whatsapp'), 0) AS whatsapp,
         COUNT(*) FILTER (WHERE delivery_status IN ('failed','undelivered') OR status = 'failed') AS failed
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND ${inRange('sent_at')}`,
      [p.from, p.to]
    ).catch(() => null),
    queryOne<Record<string, string>>(
      `SELECT COUNT(*) AS sends, COALESCE(SUM(${EMAIL_COST}), 0) AS email,
         COUNT(*) FILTER (WHERE status NOT IN ('sent','queued','delivered')) AS failed
       FROM email_logs WHERE ${inRange('sent_at')}`,
      [p.from, p.to]
    ).catch(() => null),
  ])
  const sms = n(smsWa?.sms)
  const whatsapp = n(smsWa?.whatsapp)
  const emailAmt = n(email?.email)
  return {
    total: sms + whatsapp + emailAmt,
    sms,
    whatsapp,
    email: emailAmt,
    sends: n(smsWa?.sends) + n(email?.sends),
    failed: n(smsWa?.failed) + n(email?.failed),
  }
}

async function byChannel(p: Period): Promise<ByChannelRow[]> {
  const [smsWa, email] = await Promise.all([
    queryMany<Record<string, string>>(
      `SELECT channel AS key, COUNT(*) AS sends,
         COUNT(*) FILTER (WHERE delivery_status IN ('failed','undelivered') OR status = 'failed') AS failed,
         COALESCE(SUM(${SMS_WA_COST}), 0) AS spent
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND ${inRange('sent_at')}
       GROUP BY 1`,
      [p.from, p.to]
    ).catch(() => []),
    queryOne<Record<string, string>>(
      `SELECT COUNT(*) AS sends,
         COUNT(*) FILTER (WHERE status NOT IN ('sent','queued','delivered')) AS failed,
         COALESCE(SUM(${EMAIL_COST}), 0) AS spent
       FROM email_logs WHERE ${inRange('sent_at')}`,
      [p.from, p.to]
    ).catch(() => null),
  ])
  const map = new Map<ChannelKey, ByChannelRow>()
  for (const r of smsWa)
    map.set(r.key as ChannelKey, { key: r.key as ChannelKey, sends: n(r.sends), failed: n(r.failed), spent: n(r.spent) })
  map.set('email', { key: 'email', sends: n(email?.sends), failed: n(email?.failed), spent: n(email?.spent) })
  return CHANNEL_KEYS.map(k => map.get(k) ?? { key: k, sends: 0, failed: 0, spent: 0 })
}

async function byDirection(p: Period): Promise<ByDirectionRow[]> {
  const [smsWa, email] = await Promise.all([
    queryMany<Record<string, string>>(
      `SELECT ${DIR_EXPR('kind', 'entity_type')} AS key, COUNT(*) AS sends,
         COALESCE(SUM(${SMS_WA_COST}), 0) AS spent
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND ${inRange('sent_at')}
       GROUP BY 1`,
      [p.from, p.to]
    ).catch(() => []),
    queryMany<Record<string, string>>(
      `SELECT ${DIR_EXPR('kind', 'entity_type')} AS key, COUNT(*) AS sends,
         COALESCE(SUM(${EMAIL_COST}), 0) AS spent
       FROM email_logs WHERE ${inRange('sent_at')} GROUP BY 1`,
      [p.from, p.to]
    ).catch(() => []),
  ])
  const acc: Record<string, { sends: number; spent: number }> = {}
  for (const r of [...smsWa, ...email]) {
    const slot = (acc[r.key] ??= { sends: 0, spent: 0 })
    slot.sends += n(r.sends)
    slot.spent += n(r.spent)
  }
  return DIRECTION_KEYS.map(k => ({ key: k, sends: acc[k]?.sends ?? 0, spent: acc[k]?.spent ?? 0 }))
}

async function byTemplate(p: Period): Promise<ByTemplateRow[]> {
  const [smsWa, email] = await Promise.all([
    queryMany<Record<string, string>>(
      `SELECT COALESCE(NULLIF(kind, ''), '-') AS slug, channel, COUNT(*) AS sends,
         COALESCE(SUM(${SMS_WA_COST}), 0) AS spent
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND ${inRange('sent_at')}
       GROUP BY 1, 2 ORDER BY 4 DESC, 3 DESC LIMIT 50`,
      [p.from, p.to]
    ).catch(() => []),
    queryMany<Record<string, string>>(
      `SELECT COALESCE(NULLIF(template_name, ''), '-') AS slug, 'email'::text AS channel, COUNT(*) AS sends,
         COALESCE(SUM(${EMAIL_COST}), 0) AS spent
       FROM email_logs WHERE ${inRange('sent_at')}
       GROUP BY 1 ORDER BY 4 DESC, 3 DESC LIMIT 50`,
      [p.from, p.to]
    ).catch(() => []),
  ])
  return [...smsWa, ...email]
    .map(r => ({ slug: String(r.slug), channel: r.channel as ChannelKey, sends: n(r.sends), spent: n(r.spent) }))
    .sort((a, b) => b.spent - a.spent || b.sends - a.sends)
    .slice(0, 25)
}

async function byCampaign(p: Period): Promise<ByCampaignRow[]> {
  const [smsWa, email] = await Promise.all([
    queryMany<Record<string, string>>(
      `SELECT m.entity_id AS id, COALESCE(c.title, '(deleted)') AS name, m.channel,
         COUNT(*) AS sends, COALESCE(SUM(${SMS_WA_COST}), 0) AS spent
       FROM message_logs m
       LEFT JOIN email_campaigns c ON c.id::text = m.entity_id
       WHERE m.direction = 'outbound' AND m.channel IN ('sms','whatsapp')
         AND m.entity_type = 'campaign' AND m.entity_id IS NOT NULL
         AND ${inRange('m.sent_at')}
       GROUP BY 1, 2, 3 ORDER BY 5 DESC, 4 DESC LIMIT 25`,
      [p.from, p.to]
    ).catch(() => []),
    queryMany<Record<string, string>>(
      `SELECT l.entity_id AS id, COALESCE(c.title, '(deleted)') AS name, 'email'::text AS channel,
         COUNT(*) AS sends, COALESCE(SUM(${EMAIL_COST}), 0) AS spent
       FROM email_logs l
       LEFT JOIN email_campaigns c ON c.id::text = l.entity_id
       WHERE l.entity_type = 'campaign' AND l.entity_id IS NOT NULL AND ${inRange('l.sent_at')}
       GROUP BY 1, 2 ORDER BY 5 DESC, 4 DESC LIMIT 25`,
      [p.from, p.to]
    ).catch(() => []),
  ])
  return [...smsWa, ...email]
    .map(r => ({ id: String(r.id), name: String(r.name), channel: r.channel as ChannelKey, sends: n(r.sends), spent: n(r.spent) }))
    .sort((a, b) => b.spent - a.spent || b.sends - a.sends)
    .slice(0, 25)
}

async function topRecipients(p: Period): Promise<TopRecipientRow[]> {
  const [smsWa, email] = await Promise.all([
    queryMany<Record<string, string>>(
      `SELECT to_number AS "to", channel, COUNT(*) AS sends, COALESCE(SUM(${SMS_WA_COST}), 0) AS spent
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND to_number IS NOT NULL
         AND ${inRange('sent_at')}
       GROUP BY 1, 2 ORDER BY 4 DESC, 3 DESC LIMIT 25`,
      [p.from, p.to]
    ).catch(() => []),
    queryMany<Record<string, string>>(
      `SELECT email AS "to", 'email'::text AS channel, COUNT(*) AS sends, COALESCE(SUM(${EMAIL_COST}), 0) AS spent
       FROM email_logs WHERE email IS NOT NULL AND ${inRange('sent_at')}
       GROUP BY 1 ORDER BY 4 DESC, 3 DESC LIMIT 25`,
      [p.from, p.to]
    ).catch(() => []),
  ])
  return [...smsWa, ...email]
    .map(r => ({ to: String(r.to), channel: r.channel as ChannelKey, sends: n(r.sends), spent: n(r.spent) }))
    .sort((a, b) => b.spent - a.spent || b.sends - a.sends)
    .slice(0, 25)
}

async function trend(p: Period, bucket: 'day' | 'week' | 'month') {
  const [smsWa, email] = await Promise.all([
    queryMany<{ b: string; k: string; v: string }>(
      `SELECT date_trunc($3::text, (sent_at AT TIME ZONE ${IST}))::date::text AS b, channel AS k, SUM(${SMS_WA_COST}) AS v
       FROM message_logs
       WHERE direction = 'outbound' AND channel IN ('sms','whatsapp') AND ${inRange('sent_at')}
       GROUP BY 1, 2`,
      [p.from, p.to, bucket]
    ).catch(() => []),
    queryMany<{ b: string; k: string; v: string }>(
      `SELECT date_trunc($3::text, (sent_at AT TIME ZONE ${IST}))::date::text AS b, 'email'::text AS k, SUM(${EMAIL_COST}) AS v
       FROM email_logs WHERE ${inRange('sent_at')} GROUP BY 1, 2`,
      [p.from, p.to, bucket]
    ).catch(() => []),
  ])
  return fillSeries(p, bucket, CHANNEL_KEYS, [...smsWa, ...email])
}

export async function getMessagingOverview(p: Period) {
  const prev = previousPeriod(p)
  const bucket = bucketFor(p)
  const [current, previousTotals, by_channel, by_direction, by_template, by_campaign, top_recipients, series] = await Promise.all([
    totals(p),
    totals(prev),
    byChannel(p),
    byDirection(p),
    byTemplate(p),
    byCampaign(p),
    topRecipients(p),
    trend(p, bucket),
  ])
  return {
    range: p,
    previous_range: prev,
    bucket,
    current,
    previous: previousTotals,
    series,
    by_channel,
    by_direction,
    by_template,
    by_campaign,
    top_recipients,
  }
}

export type MessagingOverview = Awaited<ReturnType<typeof getMessagingOverview>>
