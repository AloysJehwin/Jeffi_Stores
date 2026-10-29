import 'server-only'
import { randomBytes } from 'node:crypto'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { resolveCurrentTenant } from '@/lib/catalog/brand'
import type { ReplyContextRow, ScenarioKey } from './types'

// A question the store put to a customer. Its token is the customer's Reply-To address
// (reply+<slug>.<token>@reply.<domain>); WhatsApp sends are remembered by provider id so a
// "reply to this message" finds it too.

const DOMAIN = process.env.REPLY_MAIL_DOMAIN || `reply.${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}`
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const TTL_DAYS: Partial<Record<ScenarioKey, number>> = { quotation: 30, rfq_offer: 30, invoice_payment: 30, support: 60 }

export function newToken(len = 20): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function replyAddress(token: string, slug: string | null): string {
  return `reply+${slug ? `${slug}.` : ''}${token}@${DOMAIN}`
}

/** reply+<slug>.<token>@reply.<domain> → its parts; anything else is not ours. */
export function parseReplyAddress(addr: string): { slug: string | null; token: string } | null {
  const m = /^reply\+(?:([a-z0-9-]+)\.)?([a-z0-9]{16,32})@(.+)$/i.exec(addr.trim().replace(/^.*<|>.*$/g, ''))
  if (!m || m[3].toLowerCase() !== DOMAIN.toLowerCase()) return null
  return { slug: m[1]?.toLowerCase() ?? null, token: m[2].toLowerCase() }
}

export interface OpenContextInput {
  scenario: ScenarioKey
  entityType: string
  entityId: string
  refId?: string | null
  userId?: string | null
  email?: string | null
  phone?: string | null
}

/** The open context for this question, or a new one; re-asking refreshes its expiry. */
export async function openReplyContext(i: OpenContextInput): Promise<{ context: ReplyContextRow; replyTo: string }> {
  const days = TTL_DAYS[i.scenario] ?? 14
  const phone = i.phone ? i.phone.replace(/\D/g, '').slice(-10) || null : null
  const existing = await queryOne<ReplyContextRow>(
    `UPDATE reply_contexts SET last_sent_at = now(), expires_at = now() + make_interval(days => $5),
            contact_email = COALESCE($6, contact_email), contact_phone = COALESCE($7, contact_phone)
      WHERE id = (SELECT id FROM reply_contexts WHERE entity_type = $1 AND entity_id = $2 AND scenario = $3
                    AND status = 'open' AND ref_id IS NOT DISTINCT FROM $4 ORDER BY created_at DESC LIMIT 1)
      RETURNING *`,
    [i.entityType, i.entityId, i.scenario, i.refId ?? null, days, i.email ?? null, phone]
  )
  const context =
    existing ??
    (await queryOne<ReplyContextRow>(
      `INSERT INTO reply_contexts (token, user_id, contact_email, contact_phone, scenario, entity_type, entity_id, ref_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9)) RETURNING *`,
      [newToken(), i.userId ?? null, i.email ?? null, phone, i.scenario, i.entityType, i.entityId, i.refId ?? null, days]
    ))!
  const tenant = await resolveCurrentTenant().catch(() => null)
  return { context, replyTo: replyAddress(context.token, tenant?.slug ?? null) }
}

/** Best effort: a failure to open a context never blocks the message itself. */
export async function openReplyContextSafe(i: OpenContextInput): Promise<{ context: ReplyContextRow; replyTo: string } | null> {
  try {
    return await openReplyContext(i)
  } catch (err) {
    console.error('[replies] open context failed', err instanceof Error ? err.message : err)
    return null
  }
}

export async function recordContextSend(contextId: string, s: { channel: 'whatsapp' | 'sms' | 'email'; providerSid?: string | null; emailMessageId?: string | null }): Promise<void> {
  if (!s.providerSid && !s.emailMessageId) return
  await query(
    `INSERT INTO reply_context_sends (context_id, channel, provider_sid, email_message_id) VALUES ($1, $2, $3, $4)`,
    [contextId, s.channel, s.providerSid ?? null, normalizeMessageId(s.emailMessageId)]
  ).catch(err => console.error('[replies] record send failed', err instanceof Error ? err.message : err))
}

/** The decision was made some other way (the order page, an admin): stop reading replies as answers. */
export async function closeReplyContexts(entityType: string, entityId: string, scenario?: ScenarioKey): Promise<void> {
  await query(
    `UPDATE reply_contexts SET status = 'closed' WHERE entity_type = $1 AND entity_id = $2 AND status = 'open'
       ${scenario ? 'AND scenario = $3' : ''}`,
    scenario ? [entityType, entityId, scenario] : [entityType, entityId]
  ).catch(() => {})
}

export async function markAnswered(contextId: string): Promise<void> {
  await query(`UPDATE reply_contexts SET status = 'answered', answered_at = now() WHERE id = $1 AND status IN ('open', 'closed') AND answered_at IS NULL`, [contextId])
}

export function normalizeMessageId(id: string | null | undefined): string | null {
  const v = id?.trim().replace(/^<|>$/g, '').toLowerCase()
  return v || null
}

export async function contextByToken(token: string): Promise<ReplyContextRow | null> {
  return queryOne<ReplyContextRow>(`SELECT * FROM reply_contexts WHERE token = $1`, [token.toLowerCase()])
}

export async function contextBySend(s: { providerSid?: string | null; emailMessageIds?: string[] }): Promise<ReplyContextRow | null> {
  if (s.providerSid) {
    const r = await queryOne<ReplyContextRow>(
      `SELECT c.* FROM reply_context_sends x JOIN reply_contexts c ON c.id = x.context_id WHERE x.provider_sid = $1 ORDER BY x.sent_at DESC LIMIT 1`,
      [s.providerSid]
    )
    if (r) return r
  }
  const ids = (s.emailMessageIds ?? []).map(normalizeMessageId).filter((v): v is string => !!v)
  if (!ids.length) return null
  return queryOne<ReplyContextRow>(
    `SELECT c.* FROM reply_context_sends x JOIN reply_contexts c ON c.id = x.context_id WHERE x.email_message_id = ANY($1) ORDER BY x.sent_at DESC LIMIT 1`,
    [ids]
  )
}

/** A customer's open questions, newest first (support threads excluded). */
export async function openContextsFor(who: { userId?: string | null; phone?: string | null; email?: string | null }): Promise<ReplyContextRow[]> {
  const phone = who.phone ? who.phone.replace(/\D/g, '').slice(-10) : null
  if (!who.userId && !phone && !who.email) return []
  return queryMany<ReplyContextRow>(
    `SELECT * FROM reply_contexts
      WHERE status = 'open' AND expires_at > now() AND scenario <> 'support'
        AND ((user_id IS NOT NULL AND user_id = $1) OR (contact_phone IS NOT NULL AND contact_phone = $2)
             OR (contact_email IS NOT NULL AND lower(contact_email) = lower($3)))
      ORDER BY last_sent_at DESC LIMIT 8`,
    [who.userId ?? null, phone, who.email ?? null]
  )
}
