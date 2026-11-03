import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { sendAuditedMail, mailShell, escapeHtml } from '@/lib/email/shared'
import { currentBrandNameAsync, storeBaseUrlAsync } from '@/lib/catalog/brand'
import { openReplyContextSafe } from '@/lib/replies/context'
import { withReplyContext } from '@/lib/replies/scope'
import { payloadText } from './whatsapp'
import { setMessageStatus } from './messages'
import type { SessionRow } from './sessions'
import type { SupportMessage } from './types'

// Agent/AI replies to a customer who wrote by email: an email back on the same thread, with a
// Reply-To that brings their answer into this chat.

async function customerEmail(s: SessionRow): Promise<string | null> {
  if (s.contact_email) return s.contact_email
  if (!s.user_id) return null
  const u = await queryOne<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [s.user_id])
  return u?.email ?? null
}

export async function relayToEmail(s: SessionRow, m: SupportMessage, textForCustomer: string): Promise<void> {
  const to = await customerEmail(s)
  if (!to) {
    await setMessageStatus(m.id, 'failed', 'No email address for this customer')
    return
  }
  const [brand, base, extra, last] = await Promise.all([
    currentBrandNameAsync(),
    storeBaseUrlAsync().catch(() => ''),
    payloadText(m.payloads),
    queryOne<{ email_message_id: string | null }>(
      `SELECT email_message_id FROM support_messages WHERE session_id = $1 AND sender = 'customer' AND email_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [s.id]
    ),
  ])
  const text = [textForCustomer, extra].filter(Boolean).join('\n\n').trim()
  const files = m.attachments.length
    ? `<p class="muted">${m.attachments.length} attachment(s): <a href="${base}/support">open the chat</a> to view.</p>`
    : ''
  const html = mailShell({
    brand,
    kicker: s.ticket_number ? `Support · ${s.ticket_number}` : 'Support',
    title: `${m.senderName || brand} replied`,
    content: `<p style="white-space:pre-wrap;">${escapeHtml(text || 'You have a new message from support.')}</p>${files}
      <p class="muted">Reply to this email to continue the conversation.</p>`,
  })
  const subject = s.email_subject ? (/^re:/i.test(s.email_subject) ? s.email_subject : `Re: ${s.email_subject}`) : `${brand} support${s.ticket_number ? ` · ${s.ticket_number}` : ''}`
  const opened = await openReplyContextSafe({ scenario: 'support', entityType: 'support_sessions', entityId: s.id, userId: s.user_id, email: to })
  const scope = opened ? { contextId: opened.context.id, replyTo: opened.replyTo, entityType: 'support_sessions', entityId: s.id } : null
  try {
    await withReplyContext(scope, () =>
      sendAuditedMail({
        to,
        subject,
        html,
        text,
        kind: 'support_reply',
        entityType: 'support_sessions',
        entityId: s.id,
        userId: s.user_id,
        inReplyTo: last?.email_message_id ? `<${last.email_message_id}>` : undefined,
      })
    )
    await setMessageStatus(m.id, 'sent')
  } catch (err) {
    await setMessageStatus(m.id, 'failed', err instanceof Error ? err.message.slice(0, 200) : 'Email send failed')
  }
}
