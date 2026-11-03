import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { notifyCustomerIfAway } from './notify'
import type { SessionRow } from './sessions'
import type { SupportMessage } from './types'

// Where a non-customer message goes after it is stored: back to WhatsApp or email when the customer
// last wrote from there, and an away email/push when a human agent replies to an absent web/app customer.

export async function deliverOutbound(session: SessionRow, m: SupportMessage, translations: Record<string, string>): Promise<void> {
  const last = await queryOne<{ channel: string }>(
    `SELECT channel FROM support_messages WHERE session_id = $1 AND sender = 'customer' ORDER BY created_at DESC LIMIT 1`,
    [session.id]
  )
  const replyChannel = last?.channel ?? session.channel
  const forCustomer = session.customer_lang && translations[session.customer_lang] ? translations[session.customer_lang] : m.text

  if (replyChannel === 'whatsapp' && m.sender !== 'system') {
    const { relayToWhatsApp } = await import('./whatsapp')
    await relayToWhatsApp(session, m, forCustomer)
    return
  }
  if (replyChannel === 'email' && m.sender !== 'system') {
    const { relayToEmail } = await import('./email')
    await relayToEmail(session, m, forCustomer)
    return
  }
  if (m.sender === 'admin') {
    await notifyCustomerIfAway(session.id, { joined: false, agentName: m.senderName || 'Support', preview: forCustomer || null })
  }
}
