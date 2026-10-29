import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { logActivity } from '@/lib/shared/activity'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { sendFreeTextWhatsApp } from '@/lib/shared/whatsapp'
import { getWhatsAppProvider } from '@/lib/shared/messaging'
import { storeFile } from '@/lib/drive/files'
import { supportFolder } from '@/lib/drive/folders'
import { createSession, openContactSession, openSessionFor, updateSession, type SessionRow } from './sessions'
import { postMessage, type AttachmentInput } from './messages'
import { settleCustomerLang } from './translate'
import type { SupportMessage } from './types'

// One inbound WhatsApp message, from either provider's webhook: opt-out commands, then the
// customer's support chat (their account's, or a contact-only one for unknown numbers), media
// copied into the Drive. The caller schedules the AI reply.

export interface InboundWhatsApp {
  provider: 'twilio' | 'aws'
  providerSid: string | null
  from: string
  to: string
  text: string
  profileName?: string | null
  media: Array<{ ref: string; mime: string; filename?: string | null }>
}

const STOP_CMDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_CMDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE'])

const bare = (addr: string) => addr.replace(/^whatsapp:/i, '').trim()

export async function handleInboundWhatsApp(m: InboundWhatsApp): Promise<{ session: SessionRow; message: SupportMessage } | null> {
  // Webhook retries: the provider's message id is seen once.
  if (m.providerSid && (await queryOne(`SELECT 1 FROM support_messages WHERE provider_sid = $1 AND sender = 'customer' LIMIT 1`, [m.providerSid]))) return null
  const customerNumber = bare(m.from)
  const last10 = customerNumber.replace(/\D/g, '').slice(-10)
  const user = last10
    ? await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
          ORDER BY (SELECT count(*) FROM orders o WHERE o.user_id = users.id) DESC, created_at DESC LIMIT 1`,
        [last10]
      )
    : null
  const userId = user?.id ?? null

  logMessage({
    channel: 'whatsapp',
    direction: 'inbound',
    to: bare(m.to),
    from: customerNumber,
    body: m.text || (m.media.length ? `[${m.media.length} attachment(s)]` : ''),
    kind: 'inbound',
    status: 'received',
    providerSid: m.providerSid,
    provider: m.provider,
    userId,
  })

  const cmd = m.text.trim().toUpperCase()
  if (!m.media.length && (STOP_CMDS.has(cmd) || START_CMDS.has(cmd))) {
    const stop = STOP_CMDS.has(cmd)
    if (userId) {
      await query(
        stop
          ? 'UPDATE users SET marketing_opt_out = TRUE, marketing_opt_out_at = NOW() WHERE id = $1'
          : 'UPDATE users SET marketing_opt_out = FALSE, marketing_opt_out_at = NULL WHERE id = $1',
        [userId]
      )
    }
    const brand = await currentBrandNameAsync()
    await sendFreeTextWhatsApp({
      phone: customerNumber,
      body: stop
        ? `${brand}: You have been unsubscribed from promotional messages. Reply START to resubscribe.`
        : `${brand}: You are resubscribed. Reply STOP to opt out anytime.`,
      kind: 'optout',
    })
    return null
  }

  let session = userId ? await openSessionFor(userId) : last10 ? await openContactSession(last10) : null
  const isNew = !session
  if (!session) {
    session = await createSession({
      userId,
      channel: 'whatsapp',
      contactPhone: customerNumber,
      contactName: m.profileName?.slice(0, 120) || null,
    })
    if (userId) logActivity({ userId, kind: 'support_session_started', referenceId: session.id, referenceType: 'support_sessions', summary: 'Started a support chat on WhatsApp' }).catch(() => {})
  } else if (!session.contact_phone) {
    session = (await updateSession(session.id, { contact_phone: customerNumber })) ?? session
  }

  const attachments: AttachmentInput[] = []
  if (m.media.length) {
    const provider = await getWhatsAppProvider()
    const folderId = await supportFolder(session.ticket_number, session.id)
    for (const item of m.media.slice(0, 10)) {
      try {
        const { bytes, mime } = await provider.downloadMedia(item.ref)
        const f = await storeFile({ bytes, name: item.filename ?? null, mime: item.mime || mime, folderId, source: 'whatsapp', userId, maxBytes: 25 * 1024 * 1024 })
        attachments.push({ driveFileId: f.id, kind: f.kind, mime: f.mime_type, name: f.name, size: Number(f.size_bytes), width: f.width, height: f.height })
      } catch (err) {
        console.error('[support] inbound media failed', err instanceof Error ? err.message : err)
      }
    }
  }

  const settled = await settleCustomerLang(session, m.text)
  session = settled.session
  const lang = settled.lang

  const message = await postMessage({
    session,
    sender: 'customer',
    text: m.text,
    channel: 'whatsapp',
    attachments,
    lang,
    provider: m.provider,
    providerSid: m.providerSid,
    clientId: m.providerSid ? `wa:${m.providerSid}` : null,
    status: 'delivered',
    inbound: true,
  })
  if (userId) logActivity({ userId, kind: 'support_message', referenceId: session.id, referenceType: 'support_sessions', summary: 'Customer message via WhatsApp', metadata: { channel: 'whatsapp', new: isNew } }).catch(() => {})
  return { session, message }
}
