import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { sendSupportReplyEmail } from '@/lib/email'
import { notifyPush } from '@/lib/push/notify'
import { isActive } from './types'

// A human agent joined or replied while the customer was away from the chat: email them (and push
// app users), at most once per absence. AI, bot and system messages never notify; WhatsApp chats
// get the reply itself on WhatsApp.

export async function notifyCustomerIfAway(
  sessionId: string,
  p: { joined: boolean; agentName: string; preview: string | null }
): Promise<boolean> {
  const s = await queryOne<{
    user_id: string | null
    channel: string
    status: string
    ticket_number: string | null
    customer_last_seen_at: string | null
    customer_notified_at: string | null
    email: string | null
    first_name: string | null
    last_name: string | null
    business: boolean
  }>(
    `SELECT s.user_id, s.channel, s.status, s.ticket_number, s.customer_last_seen_at, s.customer_notified_at,
            u.email, u.first_name, u.last_name,
            EXISTS (SELECT 1 FROM business_profiles b WHERE b.user_id = s.user_id AND b.approval_status = 'approved') AS business
       FROM support_sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionId]
  )
  if (!s || !s.user_id || s.status !== 'open' || s.channel === 'whatsapp') return false
  if (isActive(s.customer_last_seen_at)) return false
  // Already told them since they left.
  if (s.customer_notified_at && (!s.customer_last_seen_at || new Date(s.customer_notified_at) >= new Date(s.customer_last_seen_at))) return false

  const claimed = await queryOne<{ id: string }>(
    `UPDATE support_sessions SET customer_notified_at = now()
      WHERE id = $1 AND (customer_notified_at IS NULL OR customer_notified_at < COALESCE(customer_last_seen_at, 'epoch'))
      RETURNING id`,
    [sessionId]
  )
  if (!claimed) return false

  const name = [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || 'there'
  const chatPath = s.business ? '/business/support' : '/support'
  if (s.email) {
    await sendSupportReplyEmail({
      customerName: name,
      customerEmail: s.email,
      agentName: p.agentName,
      ticket: s.ticket_number,
      preview: p.preview,
      joined: p.joined,
      userId: s.user_id,
      sessionId,
      chatPath,
    })
  }
  await notifyPush(s.user_id, {
    category: 'account',
    title: p.joined ? `${p.agentName} joined your support chat` : `${p.agentName} replied`,
    body: p.preview?.slice(0, 160) || 'Open the chat to continue.',
    link: '/support',
    source: 'transactional',
    sourceRef: sessionId,
    type: 'support_reply',
    collapseKey: `support:${sessionId}`,
  })
  return true
}

/**
 * Cron sweep: an agent's message went unread for 2 minutes and the customer is not in the chat
 * (they may have left right after it was sent). Same once-per-absence throttle.
 */
export async function sweepUnreadAgentReplies(): Promise<number> {
  const due = await query<{ session_id: string; agent: string; preview: string }>(
    `SELECT DISTINCT ON (m.session_id) m.session_id,
            COALESCE(NULLIF(trim(concat_ws(' ', au.first_name, au.last_name)), ''), s.admin_name, 'Support') AS agent,
            COALESCE(m.translations ->> s.customer_lang, m.message) AS preview
       FROM support_messages m
       JOIN support_sessions s ON s.id = m.session_id
       LEFT JOIN admins ad ON ad.id = m.admin_id
       LEFT JOIN users au ON au.id = ad.user_id
      WHERE m.sender = 'admin' AND m.read_at IS NULL AND s.status = 'open' AND s.channel <> 'whatsapp'
        AND s.user_id IS NOT NULL
        AND m.created_at < now() - interval '2 minutes' AND m.created_at > now() - interval '1 day'
        AND (s.customer_last_seen_at IS NULL OR s.customer_last_seen_at < now() - interval '45 seconds')
        AND (s.customer_notified_at IS NULL OR s.customer_notified_at < COALESCE(s.customer_last_seen_at, 'epoch'))
      ORDER BY m.session_id, m.created_at DESC`
  )
  let sent = 0
  for (const r of due.rows) {
    if (await notifyCustomerIfAway(r.session_id, { joined: false, agentName: r.agent, preview: r.preview }).catch(() => false)) sent++
  }
  return sent
}
