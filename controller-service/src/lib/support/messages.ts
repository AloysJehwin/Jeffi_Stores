import 'server-only'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { publishSupportEvent } from './events'
import type { SessionRow } from './sessions'
import type {
  AttachmentKind,
  MessageStatus,
  SupportAttachment,
  SupportChannel,
  SupportMessage,
  SupportPayload,
  SupportSender,
} from './types'

export interface AttachmentInput {
  driveFileId: string | null
  kind: AttachmentKind
  mime: string
  name: string
  size: number
  width?: number | null
  height?: number | null
  duration?: number | null
}

export interface PostInput {
  session: SessionRow
  sender: SupportSender
  text: string
  adminId?: string | null
  channel?: SupportChannel
  clientId?: string | null
  payloads?: SupportPayload[]
  attachments?: AttachmentInput[]
  lang?: string | null
  translations?: Record<string, string>
  status?: MessageStatus
  provider?: string | null
  providerSid?: string | null
  /** Skip outbound delivery (WhatsApp relay, emails) — e.g. a message that arrived from WhatsApp. */
  inbound?: boolean
}

const MESSAGE_SELECT = `
  SELECT m.*, NULLIF(trim(concat_ws(' ', au.first_name, au.last_name)), '') AS admin_display,
         COALESCE(json_agg(json_build_object(
           'id', a.id, 'kind', a.kind, 'mime', a.mime_type, 'name', a.name, 'size', a.size_bytes,
           'width', a.width, 'height', a.height, 'duration', a.duration_seconds, 'thumb', df.thumbnail_key IS NOT NULL
         ) ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
    FROM support_messages m
    LEFT JOIN admins ad ON ad.id = m.admin_id
    LEFT JOIN users au ON au.id = ad.user_id
    LEFT JOIN support_message_attachments a ON a.message_id = m.id
    LEFT JOIN drive_files df ON df.id = a.drive_file_id`

const GROUP = `GROUP BY m.id, au.first_name, au.last_name`

export function attachmentUrl(id: string, thumb = false) {
  return `/api/support/attachments/${id}${thumb ? '?thumb=1' : ''}`
}

function toAttachment(a: any): SupportAttachment {
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    name: a.name,
    size: Number(a.size ?? 0),
    width: a.width ?? null,
    height: a.height ?? null,
    duration: a.duration != null ? Number(a.duration) : null,
    url: attachmentUrl(a.id),
    thumbUrl: a.thumb ? attachmentUrl(a.id, true) : null,
  }
}

const LEGACY_SENDER: Record<string, SupportSender> = { user: 'customer' }

export function toMessageDto(r: any, brand?: string): SupportMessage {
  const sender = (LEGACY_SENDER[r.sender] ?? r.sender) as SupportSender
  const raw = r.payload
  const payloads: SupportPayload[] = Array.isArray(raw) ? raw : raw ? [raw] : []
  return {
    id: r.id,
    sessionId: r.session_id,
    sender,
    senderName:
      sender === 'admin' ? r.admin_display ?? r.admin_name ?? 'Support' : sender === 'ai' || sender === 'bot' ? (brand ? `${brand} Assistant` : 'Assistant') : null,
    text: r.message ?? '',
    original: null,
    lang: r.lang ?? null,
    at: new Date(r.created_at).toISOString(),
    status: (r.status ?? 'sent') as MessageStatus,
    channel: (r.channel ?? 'web') as SupportChannel,
    payloads,
    attachments: (Array.isArray(r.attachments) ? r.attachments : []).map(toAttachment),
    clientId: r.client_id ?? null,
    error: r.error ?? null,
  }
}

/** Show a message in the viewer's language when a translation exists. */
export function localize(m: SupportMessage, translations: Record<string, string> | null | undefined, viewerLang: string | null): SupportMessage {
  if (!viewerLang || !m.lang || m.lang === viewerLang || !m.text) return m
  const t = translations?.[viewerLang]
  return t ? { ...m, text: t, original: { text: m.text, lang: m.lang } } : m
}

export interface ListedMessage {
  message: SupportMessage
  translations: Record<string, string>
}

export async function listMessages(sessionId: string, opts: { after?: string | null; limit?: number; brand?: string } = {}): Promise<ListedMessage[]> {
  const params: unknown[] = [sessionId]
  let cursor = ''
  if (opts.after) {
    params.push(opts.after)
    cursor = `AND (m.created_at, m.id) > (SELECT created_at, id FROM support_messages WHERE id = $2)`
  }
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000)
  const rows = await queryMany(
    `SELECT * FROM (${MESSAGE_SELECT} WHERE m.session_id = $1 ${cursor} ${GROUP} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit}) x
      ORDER BY x.created_at, x.id`,
    params
  )
  return rows.map(r => ({ message: toMessageDto(r, opts.brand), translations: r.translations ?? {} }))
}

export async function getMessage(id: string, brand?: string): Promise<ListedMessage | null> {
  const r = await queryOne(`${MESSAGE_SELECT} WHERE m.id = $1 ${GROUP}`, [id])
  return r ? { message: toMessageDto(r, brand), translations: r.translations ?? {} } : null
}

/** The single write path for a support message: row, attachments, session bump, realtime, delivery. */
export async function postMessage(input: PostInput): Promise<SupportMessage> {
  const s = input.session
  const channel = input.channel ?? s.channel
  const row = await queryOne<{ id: string; inserted: boolean }>(
    `INSERT INTO support_messages
       (session_id, sender, message, admin_id, channel, client_id, payload, lang, translations, status, provider, provider_sid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (session_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET client_id = EXCLUDED.client_id
     RETURNING id, (xmax = 0) AS inserted`,
    [
      s.id,
      input.sender,
      input.text ?? '',
      input.adminId ?? null,
      channel,
      input.clientId ?? null,
      input.payloads?.length ? JSON.stringify(input.payloads) : null,
      input.lang ?? null,
      JSON.stringify(input.translations ?? {}),
      input.status ?? 'sent',
      input.provider ?? null,
      input.providerSid ?? null,
    ]
  )
  if (!row) throw new Error('support message insert failed')

  if (row.inserted) {
    for (const a of input.attachments ?? []) {
      await query(
        `INSERT INTO support_message_attachments (message_id, drive_file_id, kind, mime_type, name, size_bytes, width, height, duration_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.id, a.driveFileId, a.kind, a.mime, a.name.slice(0, 255), a.size, a.width ?? null, a.height ?? null, a.duration ?? null]
      )
    }
    const fromCustomer = input.sender === 'customer'
    await query(
      `UPDATE support_sessions SET last_message_at = now()
         ${fromCustomer && channel === 'whatsapp' ? `, wa_window_expires_at = now() + interval '24 hours'` : ''}
         ${fromCustomer && channel !== 'whatsapp' ? `, customer_last_seen_at = now()` : ''}
       WHERE id = $1`,
      [s.id]
    )
  }

  const listed = await getMessage(row.id)
  if (!listed) throw new Error('support message vanished')
  if (row.inserted) {
    await publishSupportEvent({ kind: 'message', sessionId: s.id, message: listed.message, translations: listed.translations })
    if (!input.inbound && input.sender !== 'customer') {
      const { deliverOutbound } = await import('./delivery')
      await deliverOutbound(s, listed.message, listed.translations).catch(err => console.error('[support] delivery failed', err))
    }
  }
  return listed.message
}

const RANK: Record<string, number> = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 }

/** Provider/status update for one message; never moves a tick backwards. */
export async function setMessageStatus(id: string, status: MessageStatus, error?: string | null): Promise<void> {
  const r = await queryOne<{ session_id: string; status: string; delivered_at: string | null; read_at: string | null }>(
    `UPDATE support_messages
        SET status = CASE WHEN $2 = 'failed' OR
                          (CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END) <
                          (CASE $2 WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END)
                     THEN $2 ELSE status END,
            delivered_at = CASE WHEN $2 IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
            read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, now()) ELSE read_at END,
            error = CASE WHEN $2 = 'failed' THEN $3 ELSE error END
      WHERE id = $1
      RETURNING session_id, status, delivered_at, read_at`,
    [id, status, error ?? null]
  )
  if (r) {
    await publishSupportEvent({
      kind: 'message_update',
      sessionId: r.session_id,
      id,
      status: r.status as MessageStatus,
      deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
      readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
      error: status === 'failed' ? error ?? null : undefined,
    })
  }
}

/** Status callbacks from WhatsApp providers, matched on the provider message id. */
export async function setStatusByProviderSid(sid: string, status: MessageStatus, error?: string | null): Promise<boolean> {
  const r = await queryOne<{ id: string }>(`SELECT id FROM support_messages WHERE provider_sid = $1`, [sid])
  if (!r) return false
  await setMessageStatus(r.id, status, error)
  return true
}

/**
 * Receipts from a chat client: `side` read (or received) everything the other side sent up to and
 * including `upTo`. Ticks only move forward.
 */
export async function markReceipts(sessionId: string, side: 'customer' | 'admin', state: 'delivered' | 'read', upTo: string): Promise<number> {
  const others = side === 'customer' ? `m.sender <> 'customer'` : `m.sender = 'customer'`
  const rows = await queryMany<{ id: string }>(
    `UPDATE support_messages m
        SET delivered_at = COALESCE(m.delivered_at, now()),
            read_at = CASE WHEN $3 = 'read' THEN COALESCE(m.read_at, now()) ELSE m.read_at END,
            status = CASE WHEN m.status = 'failed' THEN m.status WHEN $3 = 'read' THEN 'read'
                          WHEN m.status = 'read' THEN 'read' ELSE 'delivered' END
      WHERE m.session_id = $1 AND ${others} AND m.channel <> 'whatsapp'
        AND (m.created_at, m.id) <= (SELECT created_at, id FROM support_messages WHERE id = $2 AND session_id = $1)
        AND (CASE WHEN $3 = 'read' THEN m.read_at IS NULL ELSE m.delivered_at IS NULL END)
      RETURNING m.id`,
    [sessionId, upTo, state]
  )
  if (rows.length) {
    await publishSupportEvent({ kind: 'receipts', sessionId, side, state, upTo, at: new Date().toISOString() })
  }
  return rows.length
}

/** Persist translations computed for a message (merged, never overwritten wholesale). */
export async function saveTranslations(id: string, sessionId: string, add: Record<string, string>): Promise<void> {
  if (!Object.keys(add).length) return
  await query(`UPDATE support_messages SET translations = translations || $2::jsonb WHERE id = $1`, [id, JSON.stringify(add)])
  await publishSupportEvent({ kind: 'translation', sessionId, id, translations: add })
}

export async function setMessagePayloads(id: string, sessionId: string, payloads: SupportPayload[]): Promise<void> {
  await query(`UPDATE support_messages SET payload = $2 WHERE id = $1`, [id, JSON.stringify(payloads)])
  await publishSupportEvent({ kind: 'message_update', sessionId, id, payloads })
}

export { RANK as STATUS_RANK }
