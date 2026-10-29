import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { logActivity } from '@/lib/shared/activity'
import { cancelOrder } from '@/lib/orders/orders'
import { createReturnRequest } from '@/lib/orders/returns'
import { ORDER_ADDRESS_SELECT, submitAddressChange } from '@/lib/orders/address-change-request'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSessionRow, type SessionRow } from '../sessions'
import { getMessage, postMessage, setMessagePayloads } from '../messages'
import { translateOne } from '../translate'
import type { ConfirmPayload, SupportPayload } from '../types'
import type { Proposal } from './tools'

// AI-proposed changes. The proposal is a row plus a confirm card on the AI's message; the change
// runs only when the customer confirms, re-checked against the order as it is then, and the change
// log credits the customer.

const ACTION_TTL_MS = 24 * 60 * 60 * 1000

export interface ActionRow {
  id: string
  session_id: string
  message_id: string | null
  kind: Proposal['kind'] | 'reply'
  args: Record<string, any>
  status: ConfirmPayload['status']
  result: Record<string, any> | null
  created_at: string
  /** Set on replies to something the store asked (lib/replies). */
  context_id?: string | null
  entity_type?: string | null
  entity_id?: string | null
}

export async function createAction(sessionId: string, p: Proposal): Promise<ActionRow> {
  // One pending proposal of a kind per order: a re-proposal replaces the old card.
  const stale = await query(
    `UPDATE support_ai_actions SET status = 'expired', decided_at = now()
      WHERE session_id = $1 AND status = 'pending' AND kind = $2 AND args->>'orderId' = $3
      RETURNING id, message_id`,
    [sessionId, p.kind, String(p.args.orderId ?? '')]
  )
  for (const r of stale.rows) if (r.message_id) await markCard(r.message_id, sessionId, r.id, { status: 'expired' })
  const row = await queryOne<ActionRow>(
    `INSERT INTO support_ai_actions (session_id, kind, args) VALUES ($1, $2, $3) RETURNING *`,
    [sessionId, p.kind, JSON.stringify(p.args)]
  )
  return row!
}

export function confirmCard(actionId: string, p: Proposal): ConfirmPayload {
  return { type: 'confirm', actionId, title: p.title, detail: p.detail, confirmLabel: p.confirmLabel, status: 'pending' }
}

export async function attachActionsToMessage(messageId: string, actionIds: string[]): Promise<void> {
  if (actionIds.length) await query(`UPDATE support_ai_actions SET message_id = $1 WHERE id = ANY($2::uuid[])`, [messageId, actionIds])
}

async function markCard(messageId: string, sessionId: string, actionId: string, set: Partial<ConfirmPayload>): Promise<void> {
  const m = await getMessage(messageId)
  if (!m) return
  const payloads: SupportPayload[] = m.message.payloads.map(p => (p.type === 'confirm' && p.actionId === actionId ? { ...p, ...set } : p))
  await setMessagePayloads(messageId, sessionId, payloads)
}

export async function getAction(id: string): Promise<ActionRow | null> {
  return queryOne<ActionRow>(`SELECT * FROM support_ai_actions WHERE id = $1`, [id])
}

export type DecideResult = { ok: true; action: ActionRow } | { ok: false; status: number; error: string }

/** The customer tapped Confirm or Decline (or replied YES/NO on WhatsApp). */
export async function decideAction(actionId: string, sessionId: string, decision: 'confirm' | 'decline', customerMessageId?: string): Promise<DecideResult> {
  const a = await getAction(actionId)
  if (!a || a.session_id !== sessionId) return { ok: false, status: 404, error: 'Not found' }
  if (a.status !== 'pending') return { ok: false, status: 409, error: 'This was already answered' }
  const session = await getSessionRow(sessionId)
  if (!session || session.status !== 'open') return { ok: false, status: 409, error: 'This chat is closed' }
  if (Date.now() - new Date(a.created_at).getTime() > ACTION_TTL_MS) {
    await settle(a, session, 'expired', null)
    return { ok: false, status: 410, error: 'This expired. Ask the assistant again.' }
  }
  const claimed = await queryOne<ActionRow>(
    `UPDATE support_ai_actions SET status = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`,
    [actionId, decision === 'confirm' ? 'confirmed' : 'declined']
  )
  if (!claimed) return { ok: false, status: 409, error: 'This was already answered' }
  const link = claimed.context_id ? { replyContextId: claimed.context_id, entityType: claimed.entity_type, entityId: claimed.entity_id } : null
  if (link && customerMessageId) {
    await query(`UPDATE support_messages SET reply_context_id = $2, entity_type = $3, entity_id = $4 WHERE id = $1`, [customerMessageId, link.replyContextId, link.entityType, link.entityId])
  }

  if (decision === 'decline') {
    await settle(claimed, session, 'declined', null)
    await say(session, 'No problem, I have left it as it is. Anything else I can help with?', link)
    return { ok: true, action: claimed }
  }

  const userId = session.user_id
  const outcome = userId
    ? await runWithAuditActor(`customer:${userId}`, () => execute(claimed, userId)).catch(err => ({ ok: false as const, text: err instanceof Error ? err.message : 'Something went wrong' }))
    : { ok: false as const, text: 'This chat is not linked to an account.' }
  const done = await settle(claimed, session, outcome.ok ? 'done' : 'failed', outcome)
  await say(session, outcome.ok ? outcome.text : `I couldn't do that: ${outcome.text}`, link)
  if (outcome.ok && userId) {
    logActivity({ userId, kind: 'support_message', referenceId: session.id, referenceType: 'support_sessions', summary: `Support assistant: ${claimed.kind.replace(/_/g, ' ')} confirmed`, metadata: { actionId, ...claimed.args } }).catch(() => {})
  }
  return { ok: true, action: done ?? claimed }
}

async function settle(a: ActionRow, s: SessionRow, status: ConfirmPayload['status'], outcome: { ok: boolean; text: string } | null): Promise<ActionRow | null> {
  const row = await queryOne<ActionRow>(
    `UPDATE support_ai_actions SET status = $2, result = $3, decided_at = COALESCE(decided_at, now()) WHERE id = $1 RETURNING *`,
    [a.id, status, outcome ? JSON.stringify(outcome) : null]
  )
  if (a.message_id) await markCard(a.message_id, s.id, a.id, { status, resultText: outcome?.text })
  return row
}

/** An assistant message in the customer's language, tied to the record a reply was about. */
async function say(s: SessionRow, english: string, link?: { replyContextId: string; entityType?: string | null; entityId?: string | null } | null): Promise<void> {
  const lang = s.customer_lang && s.customer_lang !== 'en' ? s.customer_lang : null
  const text = lang ? ((await translateOne(english, lang, 'en')) ?? english) : english
  await postMessage({ session: s, sender: 'ai', text, lang: lang ?? 'en', translations: lang ? { en: english } : {}, ...(link ?? {}) })
}

async function execute(a: ActionRow, userId: string): Promise<{ ok: boolean; text: string }> {
  if (a.kind === 'reply') {
    // A reading of the customer's WhatsApp/email reply they've now confirmed (lib/replies).
    const { runReplyAction } = await import('@/lib/replies/execute')
    return runReplyAction(a as any, { userId })
  }
  const args = a.args
  if (a.kind === 'cancel_order') {
    const r = await cancelOrder(String(args.orderId), { reason: 'user_request', expectedUserId: userId })
    if (!r.success) return { ok: false, text: r.error }
    return {
      ok: true,
      text: r.directCancel
        ? `Done — order #${args.orderNumber} is cancelled.`
        : `I've sent the cancellation request for order #${args.orderNumber}. The store will confirm it shortly, and any payment is refunded to the original method once it's approved.`,
    }
  }
  if (a.kind === 'return_request') {
    const r = await createReturnRequest(userId, String(args.orderId), {
      type: args.type,
      reason: args.reason,
      description: args.description ?? null,
      image_urls: null,
      items: Array.isArray(args.items) ? args.items : [],
    })
    if (!r.ok) return { ok: false, text: r.error }
    const brand = await currentBrandNameAsync()
    return {
      ok: true,
      text: `Your ${args.type === 'refund' ? 'return' : 'replacement'} request for order #${args.orderNumber} is in. ${brand} will review it and arrange a pickup; you'll get updates by email and in your orders.`,
    }
  }
  if (a.kind === 'address_change') {
    const order = await queryOne<any>(`${ORDER_ADDRESS_SELECT} WHERE o.id = $1 AND o.user_id = $2 AND o.status <> 'draft'`, [String(args.orderId), userId])
    if (!order) return { ok: false, text: 'Order not found' }
    const r = await submitAddressChange(order, String(args.addressId), userId)
    if (!r.ok) return { ok: false, text: r.error }
    return { ok: true, text: `I've asked the store to deliver order #${args.orderNumber} to ${r.request.newAddress.city} ${r.request.newAddress.postal_code}. You'll hear back once they approve it.` }
  }
  return { ok: false, text: 'Unknown action' }
}

/** WhatsApp has no buttons: YES/NO answers the newest pending card. */
export async function pendingActionForReply(sessionId: string): Promise<ActionRow | null> {
  return queryOne<ActionRow>(
    `SELECT * FROM support_ai_actions WHERE session_id = $1 AND status = 'pending' AND awaiting = 'customer' AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  )
}

const YES = /^(yes|y|yeah|yep|ok|okay|confirm|haan|ha|han|ji|haa|हाँ|हां|ஆம்|అవును|ಹೌದು|അതെ|होय|হ্যাঁ|હા|ਹਾਂ)[.! ]*$/i
const NO = /^(no|n|nope|nah|cancel|nahi|nahin|na|नहीं|இல்லை|కాదు|ಇಲ್ಲ|ഇല്ല|नाही|না|ના|ਨਹੀਂ)[.! ]*$/i

export function yesNo(text: string): 'confirm' | 'decline' | null {
  const t = text.trim()
  if (YES.test(t)) return 'confirm'
  if (NO.test(t)) return 'decline'
  return null
}
