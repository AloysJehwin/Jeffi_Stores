import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { logActivity } from '@/lib/shared/activity'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { postMessage } from '@/lib/support/messages'
import { translateOne } from '@/lib/support/translate'
import { yesNo } from '@/lib/support/agent/actions'
import type { SessionRow } from '@/lib/support/sessions'
import type { ConfirmPayload, SupportMessage } from '@/lib/support/types'
import { contextBySend, contextByToken, markAnswered, openContextsFor } from './context'
import { readReply, type Candidate } from './read'
import { decideOutcome } from './policy'
import { scenarioFor } from './scenarios'
import { runReplyAction, type ReplyAction } from './execute'
import type { Reading, ReplyContextRow, Tier } from './types'

// A customer's WhatsApp/email/chat message that may answer a question the store asked: match it to
// the question, read what they mean, then apply it, ask them to confirm, or hand it to an admin.
// 'unhandled' sends it on to the support assistant.

export interface IncomingReply {
  session: SessionRow
  message: SupportMessage
  userId: string | null
  phone?: string | null
  email?: string | null
  /** WhatsApp: the message they replied to. */
  repliedToSid?: string | null
  /** Email: In-Reply-To / References. */
  emailRefs?: string[]
  /** Email: the Reply-To token they wrote to. */
  token?: string | null
  /** The sender is who the question went to (phone matched, DKIM + From matched, signed in). */
  verified: boolean
}

export async function handleCustomerReply(r: IncomingReply): Promise<'handled' | 'unhandled'> {
  const flags = await getFeatureFlags().catch(() => null)
  if (flags && !flags.replyActionsEnabled) return 'unhandled'
  const text = r.message.text.trim()
  if (!text && !r.message.attachments.length) return 'unhandled'

  const candidates = await candidatesFor(r)
  if (!candidates.length) return 'unhandled'

  const english = r.message.lang && r.message.lang !== 'en' && text ? await translateOne(text, 'en', r.message.lang) : null
  let reading = await readReply({
    candidates: candidates.map(c => ({ scenario: c.scenario, snapshot: c.snapshot })),
    text,
    english,
    attachments: r.message.attachments.map(a => a.kind),
  })
  // No model (plan, outage): a bare yes/no still answers a single open question.
  if (!reading && candidates.length === 1) {
    const yn = yesNo(text)
    const c = candidates[0]
    const intent = yn === 'confirm' ? c.scenario.yes : yn === 'decline' ? c.scenario.no : null
    if (intent) reading = { contextIndex: 0, intent, args: {}, confidence: 0.7, reading: `Replied "${text}"` }
  }
  if (!reading) {
    // Unread but clearly about this record: link it and let a person look.
    if (candidates.length === 1 && candidates[0].direct) await linkMessage(r.message.id, candidates[0].context)
    return 'unhandled'
  }
  if (reading.contextIndex == null) {
    if (candidates.length === 1 && candidates[0].direct) await linkMessage(r.message.id, candidates[0].context)
    return 'unhandled'
  }

  const c = candidates[reading.contextIndex]
  await linkMessage(r.message.id, c.context)
  const def = c.scenario.intents[reading.intent]
  const tier: Tier = typeof def.tier === 'function' ? def.tier(c.snapshot, reading.args) : def.tier
  const outcome = decideOutcome({ tier, confidence: reading.confidence, verified: r.verified, autoApply: flags?.replyAutoApply !== false })
  const title = def.title(c.snapshot, reading.args)
  const action = await createReplyAction(r.session.id, c.context, reading, title, outcome === 'admin' ? 'admin' : outcome === 'ask' ? 'customer' : 'none')

  if (outcome === 'apply') {
    const res = await runReplyAction(action, { userId: r.userId, auto: true })
    await say(r.session, res.ok ? res.text : `Sorry, I couldn't do that: ${res.text}`, c.context)
    notifyAdmins(c, title, reading, res.ok ? 'applied' : 'failed', r.session).catch(() => {})
  } else if (outcome === 'ask') {
    const card: ConfirmPayload = { type: 'confirm', actionId: action.id, title: `${title}?`, confirmLabel: 'Yes', status: 'pending' }
    const m = await say(r.session, `Just to confirm: ${lowerFirst(title)}? Reply YES or NO.`, c.context, [card])
    await query(`UPDATE support_ai_actions SET message_id = $2 WHERE id = $1`, [action.id, m.id])
  } else {
    await say(
      r.session,
      def.manual ? `Thanks, I've passed this on. Our team will look at it and get back to you.` : `Thanks, I've passed this to our team to confirm. You'll hear back shortly.`,
      c.context
    )
    notifyAdmins(c, title, reading, 'review', r.session).catch(() => {})
  }
  if (r.userId) {
    logActivity({
      userId: r.userId,
      kind: 'support_message',
      referenceId: c.context.entity_id,
      referenceType: c.context.entity_type,
      summary: `Replied about ${c.scenario.label.toLowerCase()}: ${reading.reading || reading.intent}`,
      metadata: { channel: r.message.channel, intent: reading.intent, outcome, confidence: reading.confidence },
    }).catch(() => {})
  }
  return 'handled'
}

interface Matched extends Candidate {
  context: ReplyContextRow
  direct: boolean
}

async function candidatesFor(r: IncomingReply): Promise<Matched[]> {
  const direct = r.token ? await contextByToken(r.token) : r.repliedToSid || r.emailRefs?.length ? await contextBySend({ providerSid: r.repliedToSid, emailMessageIds: r.emailRefs }) : null
  const usable = (c: ReplyContextRow | null) => !!c && c.status === 'open' && new Date(c.expires_at).getTime() > Date.now() && c.scenario !== 'support' && belongs(c, r)
  const contexts = usable(direct) ? [direct!] : await openContextsFor({ userId: r.userId, phone: r.phone, email: r.email })
  const out: Matched[] = []
  for (const ctx of contexts) {
    const scenario = scenarioFor(ctx.scenario)
    if (!scenario) continue
    const snapshot = await scenario.snapshot(ctx).catch(() => null)
    if (!snapshot) {
      await query(`UPDATE reply_contexts SET status = 'closed' WHERE id = $1 AND status = 'open'`, [ctx.id])
      continue
    }
    out.push({ context: ctx, scenario, snapshot, direct: ctx.id === direct?.id })
  }
  return out
}

/** A token or a quoted message proves which question; it must still be the same customer's. */
function belongs(c: ReplyContextRow, r: IncomingReply): boolean {
  if (c.user_id && r.userId) return c.user_id === r.userId
  const phone = r.phone?.replace(/\D/g, '').slice(-10)
  if (c.contact_phone && phone) return c.contact_phone === phone
  if (c.contact_email && r.email) return c.contact_email.toLowerCase() === r.email.toLowerCase()
  return !!r.token
}

async function linkMessage(messageId: string, ctx: ReplyContextRow): Promise<void> {
  await query(`UPDATE support_messages SET reply_context_id = $2, entity_type = $3, entity_id = $4 WHERE id = $1`, [messageId, ctx.id, ctx.entity_type, ctx.entity_id])
}

async function createReplyAction(sessionId: string, ctx: ReplyContextRow, reading: Reading, title: string, awaiting: 'customer' | 'admin' | 'none'): Promise<ReplyAction> {
  // A newer answer to the same question replaces one still waiting.
  await query(
    `UPDATE support_ai_actions SET status = 'expired', decided_at = now() WHERE context_id = $1 AND status = 'pending'`,
    [ctx.id]
  )
  return (await queryOne<ReplyAction>(
    `INSERT INTO support_ai_actions (session_id, kind, args, awaiting, context_id, entity_type, entity_id, confidence, reading)
     VALUES ($1, 'reply', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [sessionId, JSON.stringify({ scenario: ctx.scenario, intent: reading.intent, args: reading.args, title }), awaiting, ctx.id, ctx.entity_type, ctx.entity_id, reading.confidence, reading.reading || null]
  ))!
}

/** An assistant message in the customer's language, tied to the record. */
async function say(s: SessionRow, english: string, ctx: ReplyContextRow, payloads?: ConfirmPayload[]): Promise<SupportMessage> {
  const lang = s.customer_lang && s.customer_lang !== 'en' ? s.customer_lang : null
  const text = lang ? ((await translateOne(english, lang, 'en')) ?? english) : english
  return postMessage({
    session: s,
    sender: 'ai',
    text,
    lang: lang ?? 'en',
    translations: lang ? { en: english } : {},
    payloads,
    replyContextId: ctx.id,
    entityType: ctx.entity_type,
    entityId: ctx.entity_id,
  })
}

async function notifyAdmins(c: Matched, title: string, reading: Reading, kind: 'applied' | 'failed' | 'review', s: SessionRow): Promise<void> {
  const who = s.contact_name || 'Customer'
  await createAdminNotification({
    type: kind === 'review' ? 'customer_reply_review' : 'customer_reply_applied',
    category: c.context.entity_type === 'orders' ? 'orders' : c.context.entity_type === 'quotations' || c.context.entity_type === 'business_rfqs' ? 'b2b' : 'support',
    title: kind === 'review' ? `Customer reply needs approval: ${title}` : kind === 'failed' ? `Customer reply could not be applied: ${title}` : `Applied from a customer reply: ${title}`,
    message: reading.reading ? `${who}: ${reading.reading}` : null,
    link: c.scenario.href(c.context),
    entityType: c.context.entity_type,
    entityId: c.context.entity_id,
    severity: kind === 'applied' ? 'info' : 'warning',
    scope: c.scenario.scope.replace(/:write$/, ':read'),
  })
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export { markAnswered }
