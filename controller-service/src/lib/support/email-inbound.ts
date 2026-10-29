import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { storeFile } from '@/lib/drive/files'
import { supportFolder } from '@/lib/drive/folders'
import { contextByToken } from '@/lib/replies/context'
import { createSession, getSessionRow, openEmailSession, openSessionFor, updateSession, type SessionRow } from './sessions'
import { postMessage, type AttachmentInput } from './messages'
import { settleCustomerLang } from './translate'
import type { SupportMessage } from './types'

// One email a customer sent to a reply+<token> address (or answered one of our mails): into their
// support chat as an email message, attachments in the Drive. The caller runs the reply engine.

export interface InboundEmail {
  /** SES's id for the received mail: each one is handled once. */
  sesId: string
  /** The mail's own Message-ID, answered with In-Reply-To when we write back. */
  messageId: string | null
  from: string
  fromName: string | null
  subject: string
  /** The new text only (quoted history and signature removed). */
  text: string
  token: string | null
  attachments: Array<{ filename: string | null; contentType: string; content: Buffer }>
}

export async function handleInboundEmail(m: InboundEmail): Promise<{ session: SessionRow; message: SupportMessage; userId: string | null } | null> {
  if (!m.text && !m.attachments.length) return null
  if (await queryOne(`SELECT 1 FROM support_messages WHERE provider = 'ses' AND provider_sid = $1 LIMIT 1`, [m.sesId])) return null
  const from = m.from.trim().toLowerCase()
  const user = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 ORDER BY (SELECT count(*) FROM orders o WHERE o.user_id = users.id) DESC, created_at DESC LIMIT 1`,
    [from]
  )
  // The question's own account wins when it has this address (a business and a shop account can share one).
  const ctx = m.token ? await contextByToken(m.token) : null
  const owner = ctx?.user_id ? await queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND lower(email) = $2`, [ctx.user_id, from]) : null
  const userId = owner?.id ?? user?.id ?? null

  // A reply to one of our support emails continues that chat.
  let session = ctx?.scenario === 'support' && ctx.entity_type === 'support_sessions' ? await getSessionRow(ctx.entity_id) : null
  if (session && (session.status !== 'open' || (session.user_id && userId && session.user_id !== userId))) session = null
  session ??= userId ? await openSessionFor(userId) : await openEmailSession(from)
  const isNew = !session
  if (!session) {
    session = await createSession({ userId, channel: 'email', contactEmail: from, contactName: m.fromName?.slice(0, 120) || null })
    if (userId) logActivity({ userId, kind: 'support_session_started', referenceId: session.id, referenceType: 'support_sessions', summary: 'Started a support chat by email' }).catch(() => {})
  }
  const subject = m.subject.trim().slice(0, 255) || null
  if (!session.contact_email || (subject && subject !== session.email_subject)) {
    session = (await updateSession(session.id, { contact_email: session.contact_email ?? from, email_subject: subject ?? session.email_subject })) ?? session
  }

  const attachments: AttachmentInput[] = []
  if (m.attachments.length) {
    const folderId = await supportFolder(session.ticket_number, session.id)
    for (const a of m.attachments.slice(0, 10)) {
      try {
        const f = await storeFile({ bytes: a.content, name: a.filename, mime: a.contentType, folderId, source: 'email', userId, maxBytes: 25 * 1024 * 1024 })
        attachments.push({ driveFileId: f.id, kind: f.kind, mime: f.mime_type, name: f.name, size: Number(f.size_bytes), width: f.width, height: f.height })
      } catch (err) {
        console.error('[support] inbound email attachment failed', err instanceof Error ? err.message : err)
      }
    }
  }
  if (!m.text && !attachments.length) return null
  const settled = await settleCustomerLang(session, m.text)
  session = settled.session
  const message = await postMessage({
    session,
    sender: 'customer',
    text: m.text,
    channel: 'email',
    attachments,
    lang: settled.lang,
    provider: 'ses',
    providerSid: m.sesId,
    clientId: `ses:${m.sesId}`,
    status: 'delivered',
    inbound: true,
    emailMessageId: m.messageId,
  })
  if (userId) logActivity({ userId, kind: 'support_message', referenceId: session.id, referenceType: 'support_sessions', summary: 'Customer message by email', metadata: { channel: 'email', new: isNew } }).catch(() => {})
  return { session, message, userId }
}
