import { queryMany, queryOne } from '@/lib/shared/db'
import { getS3Url } from '@/lib/shared/s3'
import {
  CONVERSATION_CHANNELS,
  clampConversationLimit,
  emptyChannelCounts,
  isConversationChannel,
  type ConversationAttachment,
  type ConversationChannel,
  type ConversationDirection,
  type ConversationItem,
  type ConversationSummary,
} from '@/lib/shared/customer-conversations-shared'

export type {
  ConversationAttachment,
  ConversationChannel,
  ConversationDirection,
  ConversationItem,
  ConversationSummary,
}
export {
  CONVERSATION_CHANNELS,
  isConversationChannel,
  parseChannels,
  clampConversationLimit,
} from '@/lib/shared/customer-conversations-shared'

export interface ConversationRow {
  id: string
  channel: string
  direction: string
  at: string | Date
  thread_id: string | null
  thread_label: string | null
  actor: string | null
  subject: string | null
  body: string | null
  status: string | null
  entity_type: string | null
  entity_id: string | null
  attachments: Array<{ kind: string; s3_key: string; s3_thumbnail_key: string | null }> | null
}

export interface ListConversationsOptions {
  channels?: ConversationChannel[]
  before?: string | null
  limit?: number
  q?: string | null
}

const PHONE10 = (col: string) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`
const ME_EMAIL = `(SELECT me.email FROM me)`
const ME_PHONE = `(SELECT me.phone10 FROM me WHERE length(me.phone10) = 10)`
const ADMIN_NAME = `NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')`

const CHANNEL_SQL: Record<ConversationChannel, string> = {
  chat: `
    SELECT m.id::text AS id, 'chat' AS channel,
           CASE WHEN m.sender = 'customer' THEN 'inbound' ELSE 'outbound' END AS direction,
           m.created_at AS at, s.id::text AS thread_id,
           'Chat, ' || CASE WHEN s.status = 'open' THEN 'open' ELSE 'closed' END AS thread_label,
           CASE WHEN m.sender = 'customer' THEN NULL WHEN m.sender = 'bot' THEN 'Bot' ELSE COALESCE(s.admin_name, 'Admin') END AS actor,
           NULL::text AS subject, m.message AS body, NULL::text AS status,
           'support_session'::text AS entity_type, s.id::text AS entity_id, '[]'::json AS attachments
    FROM support_messages m JOIN support_sessions s ON s.id = m.session_id
    WHERE s.user_id = $1`,
  email: `
    SELECT e.id::text AS id, 'email' AS channel, 'outbound' AS direction, e.sent_at AS at,
           NULL::text AS thread_id,
           COALESCE(NULLIF(e.entity_type, '') || ':' || NULLIF(e.entity_id, ''), e.subject) AS thread_label,
           COALESCE(NULLIF(e.template_name, ''), NULLIF(e.kind, ''), 'Store') AS actor, e.subject AS subject,
           left(COALESCE(NULLIF(e.body_text, ''),
                regexp_replace(regexp_replace(COALESCE(e.body_html, ''), '<(style|script|head)[^>]*>.*?</\\1>', ' ', 'gi'), '<[^>]+>', ' ', 'g')), 4000) AS body,
           e.status AS status, e.entity_type AS entity_type, e.entity_id AS entity_id, '[]'::json AS attachments
    FROM email_logs e
    WHERE e.user_id = $1 OR lower(e.email) = ${ME_EMAIL}`,
  whatsapp: `
    SELECT l.id::text AS id, 'whatsapp' AS channel, CASE WHEN l.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END AS direction, l.sent_at AS at,
           NULL::text AS thread_id, NULL::text AS thread_label, CASE WHEN l.direction = 'inbound' THEN NULL ELSE 'Store' END AS actor,
           NULL::text AS subject, l.body AS body, l.status AS status, l.entity_type AS entity_type, l.entity_id AS entity_id, '[]'::json AS attachments
    FROM message_logs l
    WHERE l.channel = 'whatsapp' AND (l.user_id = $1 OR ${PHONE10('l.to_number')} = ${ME_PHONE} OR ${PHONE10('l.from_number')} = ${ME_PHONE})`,
  sms: `
    SELECT l.id::text AS id, 'sms' AS channel, CASE WHEN l.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END AS direction, l.sent_at AS at,
           NULL::text AS thread_id, NULL::text AS thread_label, CASE WHEN l.direction = 'inbound' THEN NULL ELSE 'Store' END AS actor,
           NULL::text AS subject, l.body AS body, l.status AS status, l.entity_type AS entity_type, l.entity_id AS entity_id, '[]'::json AS attachments
    FROM message_logs l
    WHERE l.channel = 'sms' AND (l.user_id = $1 OR ${PHONE10('l.to_number')} = ${ME_PHONE} OR ${PHONE10('l.from_number')} = ${ME_PHONE})`,
  note: `
    SELECT n.id::text AS id, 'note' AS channel, 'internal' AS direction, n.created_at AS at, NULL::text AS thread_id, NULL::text AS thread_label,
           COALESCE(${ADMIN_NAME}, u.email, CASE WHEN n.source = 'staff_form' THEN 'Staff form' ELSE 'Admin' END) AS actor,
           n.title AS subject, n.body AS body, CASE WHEN n.shared_with_customer THEN 'shared with customer' END AS status,
           CASE WHEN n.order_id IS NOT NULL THEN 'order' WHEN n.return_request_id IS NOT NULL THEN 'return' END AS entity_type,
           COALESCE(n.order_id::text, n.return_request_id::text) AS entity_id,
           COALESCE((SELECT json_agg(json_build_object('kind', att.kind, 's3_key', att.s3_key, 's3_thumbnail_key', att.s3_thumbnail_key)
                            ORDER BY att.display_order, att.created_at)
                     FROM customer_note_attachments att WHERE att.note_id = n.id), '[]'::json) AS attachments
    FROM customer_notes n
    LEFT JOIN admins a ON a.id = n.admin_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE n.user_id = $1`,
  rfq: `
    SELECT m.id::text AS id, 'rfq' AS channel, CASE WHEN m.sender = 'customer' THEN 'inbound' ELSE 'outbound' END AS direction, m.created_at AS at,
           r.id::text AS thread_id, 'RFQ ' || r.rfq_number AS thread_label, CASE WHEN m.sender = 'customer' THEN NULL ELSE 'Admin' END AS actor,
           NULL::text AS subject, m.message AS body, r.status AS status, 'rfq' AS entity_type, r.id::text AS entity_id, '[]'::json AS attachments
    FROM rfq_messages m JOIN business_rfqs r ON r.id = m.rfq_id
    WHERE r.user_id = $1`,
}

const ME_CTE = `WITH me AS (
  SELECT lower(u.email) AS email, ${PHONE10('u.phone')} AS phone10 FROM users u WHERE u.id = $1
)`

export function buildConversationsSql(channels: ConversationChannel[]): string {
  const parts = channels.map(c => CHANNEL_SQL[c]).join('\n    UNION ALL')
  return `${ME_CTE}
  SELECT x.* FROM (${parts}) x
  WHERE ($2::timestamptz IS NULL OR x.at < $2::timestamptz)
    AND ($3::text IS NULL OR x.subject ILIKE $3 OR x.body ILIKE $3)
  ORDER BY x.at DESC NULLS LAST
  LIMIT $4`
}

const ENTITIES: Record<string, string> = {
  order: 'Order',
  orders: 'Order',
  return: 'Return',
  rfq: 'RFQ',
  quotations: 'Quotation',
  quotation: 'Quotation',
  support_session: 'Chat',
  purchase_orders: 'Purchase order',
  product_reviews: 'Review',
  review: 'Review',
  campaign: 'Campaign',
  email_campaigns: 'Campaign',
  address_change: 'Address change',
}

export function entityHref(entityType: string | null, entityId: string | null, userId: string): string | null {
  if (!entityType || !entityId) return null
  switch (entityType) {
    case 'order':
    case 'orders':
      return `/admin/orders/${entityId}`
    case 'rfq':
      return `/admin/business/rfqs/${entityId}`
    case 'quotation':
    case 'quotations':
      return `/admin/quotations/${entityId}`
    case 'support_session':
      return `/admin/customers/${userId}?chat=true`
    default:
      return null
  }
}

function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/^\w/, c => c.toUpperCase())
}

const ENTITY_DECODE: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

export function normalizeBody(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITY_DECODE[name] ?? m)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function threadLabelFor(row: ConversationRow): string | null {
  if (row.thread_label) return row.thread_label
  if (row.channel !== 'email' || !row.thread_id) return null
  if (row.entity_type && row.entity_id)
    return `${ENTITIES[row.entity_type] ?? humanizeToken(row.entity_type)} ${row.entity_id.slice(0, 8)}`
  return row.subject
}

async function mapAttachments(list: ConversationRow['attachments']): Promise<ConversationAttachment[]> {
  if (!Array.isArray(list) || list.length === 0) return []
  return Promise.all(
    list.map(async a => ({
      kind: a.kind,
      url: await getS3Url(a.s3_key),
      thumbnailUrl: a.s3_thumbnail_key ? await getS3Url(a.s3_thumbnail_key) : null,
    }))
  )
}

export async function mapConversationRow(row: ConversationRow, userId: string): Promise<ConversationItem> {
  const channel = isConversationChannel(row.channel) ? row.channel : 'email'
  const direction: ConversationDirection =
    row.direction === 'inbound' ? 'inbound' : row.direction === 'internal' ? 'internal' : 'outbound'
  const subject =
    (channel === 'whatsapp' || channel === 'sms') && row.subject ? humanizeToken(row.subject) : row.subject
  const href =
    channel === 'chat'
      ? entityHref('support_session', row.thread_id, userId)
      : channel === 'rfq'
        ? entityHref('rfq', row.thread_id, userId)
        : entityHref(row.entity_type, row.entity_id, userId)
  return {
    id: row.id,
    channel,
    direction,
    at: toIso(row.at),
    threadId: row.thread_id,
    threadLabel: threadLabelFor(row),
    actor: row.actor,
    subject: subject || null,
    body: normalizeBody(row.body),
    status: row.status || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    attachments: await mapAttachments(row.attachments),
    href,
  }
}

export function derivePage<T extends { at: string }>(
  items: T[],
  limit: number
): { items: T[]; nextBefore: string | null } {
  if (items.length <= limit) return { items, nextBefore: null }
  const page = items.slice(0, limit)
  return { items: page, nextBefore: page[page.length - 1].at }
}

export async function listConversations(
  userId: string,
  opts: ListConversationsOptions = {}
): Promise<{ items: ConversationItem[]; nextBefore: string | null }> {
  const channels = opts.channels?.length ? opts.channels.filter(isConversationChannel) : [...CONVERSATION_CHANNELS]
  if (channels.length === 0) throw new Error('No valid channels')
  const limit = clampConversationLimit(opts.limit)
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before).toISOString() : null
  const q = opts.q?.trim() ? `%${opts.q.trim().replace(/[%_\\]/g, m => `\\${m}`)}%` : null
  const rows = await queryMany<ConversationRow>(buildConversationsSql(channels), [userId, before, q, limit + 1])
  const items = await Promise.all(rows.map(r => mapConversationRow(r, userId)))
  return derivePage(items, limit)
}

export const SUMMARY_SQL = `
  WITH ev AS (
    SELECT 'chat' AS channel, CASE WHEN m.sender = 'customer' THEN 'inbound' ELSE 'outbound' END AS direction, m.created_at AS at
    FROM support_messages m JOIN support_sessions s ON s.id = m.session_id WHERE s.user_id = $1
    UNION ALL
    SELECT 'email', 'outbound', e.sent_at FROM email_logs e WHERE e.user_id = $1 OR ($2::text IS NOT NULL AND lower(e.email) = $2)
    UNION ALL
    SELECT l.channel, CASE WHEN l.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END, l.sent_at
    FROM message_logs l
    WHERE l.channel IN ('whatsapp', 'sms')
      AND (l.user_id = $1 OR ($3::text IS NOT NULL AND (${PHONE10('l.to_number')} = $3 OR ${PHONE10('l.from_number')} = $3)))
    UNION ALL
    SELECT 'note', 'internal', n.created_at FROM customer_notes n WHERE n.user_id = $1
    UNION ALL
    SELECT 'rfq', CASE WHEN m.sender = 'customer' THEN 'inbound' ELSE 'outbound' END, m.created_at
    FROM rfq_messages m JOIN business_rfqs r ON r.id = m.rfq_id WHERE r.user_id = $1
  ), first_reply AS (
    SELECT EXTRACT(EPOCH FROM (MIN(m.created_at) FILTER (WHERE m.sender = 'admin') - MIN(m.created_at) FILTER (WHERE m.sender = 'customer'))) / 60 AS minutes
    FROM support_sessions s JOIN support_messages m ON m.session_id = s.id
    WHERE s.user_id = $1 AND s.created_at >= now() - interval '90 days'
    GROUP BY s.id
    HAVING MIN(m.created_at) FILTER (WHERE m.sender = 'admin') >= MIN(m.created_at) FILTER (WHERE m.sender = 'customer')
  )
  SELECT
    (SELECT json_object_agg(c.channel, c.n) FROM (SELECT channel, count(*) AS n FROM ev WHERE at >= now() - interval '30 days' GROUP BY channel) c) AS counts_30d,
    (SELECT json_object_agg(c.channel, c.n) FROM (SELECT channel, count(*) AS n FROM ev WHERE at >= now() - interval '90 days' GROUP BY channel) c) AS counts_90d,
    (SELECT max(at) FROM ev WHERE direction = 'inbound') AS last_inbound_at,
    (SELECT max(at) FROM ev WHERE direction = 'outbound') AS last_outbound_at,
    (SELECT count(*) FROM support_sessions s WHERE s.user_id = $1 AND s.status = 'open') AS open_chats,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) FROM first_reply) AS median_first_response_minutes`

export interface SummaryRow {
  counts_30d: Record<string, number | string> | null
  counts_90d: Record<string, number | string> | null
  last_inbound_at: string | Date | null
  last_outbound_at: string | Date | null
  open_chats: number | string | null
  median_first_response_minutes: number | string | null
}

function toCounts(raw: Record<string, number | string> | null): Record<ConversationChannel, number> {
  const out = emptyChannelCounts()
  for (const [k, v] of Object.entries(raw ?? {})) if (isConversationChannel(k)) out[k] = Number(v) || 0
  return out
}

export function phoneLast10(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

export function summarizeRow(row: SummaryRow | null): ConversationSummary {
  const lastInboundAt = row?.last_inbound_at ? toIso(row.last_inbound_at) : null
  const lastOutboundAt = row?.last_outbound_at ? toIso(row.last_outbound_at) : null
  const awaitingReply = !!lastInboundAt && (!lastOutboundAt || Date.parse(lastInboundAt) > Date.parse(lastOutboundAt))
  const median = row?.median_first_response_minutes
  return {
    counts30d: toCounts(row?.counts_30d ?? null),
    counts90d: toCounts(row?.counts_90d ?? null),
    lastInboundAt,
    lastOutboundAt,
    openChats: Number(row?.open_chats) || 0,
    awaitingReply,
    awaitingReplySince: awaitingReply ? lastInboundAt : null,
    medianFirstResponseMinutes: median == null || median === '' ? null : Math.round(Number(median) * 10) / 10,
  }
}

export async function conversationSummary(
  userId: string,
  email: string | null | undefined,
  phone: string | null | undefined
): Promise<ConversationSummary> {
  const row = await queryOne<SummaryRow>(SUMMARY_SQL, [
    userId,
    email?.trim() ? email.trim().toLowerCase() : null,
    phoneLast10(phone),
  ])
  return summarizeRow(row)
}
