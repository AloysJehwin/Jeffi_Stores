import { randomBytes } from 'node:crypto'
import { currentTenant, PLATFORM_TENANT_ID, query, queryOne } from '@jeffi/tenancy'

// Customer replies to a document we email (a quotation...) come back through a reply+<store>.<token>
// address and are read by the controller (controller-service/src/lib/replies). Same table, token
// alphabet and address format as its context.ts.

const DOMAIN = process.env.REPLY_MAIL_DOMAIN || `reply.${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}`
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

function newToken(len = 20): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export interface ReplyTarget {
  contextId: string
  replyTo: string
}

/** The open question for this record, or a new one (30 days). Never throws: mail goes out regardless. */
async function openReplyContext(i: { scenario: string; entityType: string; entityId: string; userId: string | null; email: string | null; phone: string | null }): Promise<ReplyTarget | null> {
  try {
    const phone = i.phone ? i.phone.replace(/\D/g, '').slice(-10) || null : null
    const row =
      (await queryOne<{ id: string; token: string }>(
        `UPDATE reply_contexts SET last_sent_at = now(), expires_at = now() + interval '30 days',
                contact_email = COALESCE($4, contact_email), contact_phone = COALESCE($5, contact_phone)
          WHERE id = (SELECT id FROM reply_contexts WHERE entity_type = $1 AND entity_id = $2 AND scenario = $3 AND status = 'open'
                       ORDER BY created_at DESC LIMIT 1)
          RETURNING id, token`,
        [i.entityType, i.entityId, i.scenario, i.email, phone]
      )) ??
      (await queryOne<{ id: string; token: string }>(
        `INSERT INTO reply_contexts (token, user_id, contact_email, contact_phone, scenario, entity_type, entity_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 days') RETURNING id, token`,
        [newToken(), i.userId, i.email, phone, i.scenario, i.entityType, i.entityId]
      ))
    if (!row) return null
    const t = currentTenant()
    const slug = t && t.tenantId !== PLATFORM_TENANT_ID ? t.slug : null
    return { contextId: row.id, replyTo: `reply+${slug ? `${slug}.` : ''}${row.token}@${DOMAIN}` }
  } catch (err) {
    console.error('[reply-context] open failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** A quotation emailed to its consignee: the customer is the RFQ's account when it came from one. */
export async function quotationReply(q: { id: string; consignee_email: string | null; consignee_phone?: string | null }): Promise<ReplyTarget | null> {
  if (!q.consignee_email) return null
  const user = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM business_rfqs WHERE converted_quotation_id = $1
     UNION ALL SELECT id FROM users WHERE lower(email) = lower($2) LIMIT 1`,
    [q.id, q.consignee_email]
  ).catch(() => null)
  return openReplyContext({ scenario: 'quotation', entityType: 'quotations', entityId: q.id, userId: user?.user_id ?? null, email: q.consignee_email.toLowerCase(), phone: q.consignee_phone ?? null })
}

/** The sent mail's SES id, so a reply quoting it (In-Reply-To) finds the question without the token. */
export async function recordEmailSend(contextId: string, providerRef: string | null | undefined): Promise<void> {
  if (!providerRef) return
  const id = (providerRef.includes('@') ? providerRef : `${providerRef}@email.amazonses.com`).replace(/^<|>$/g, '').toLowerCase()
  await query(`INSERT INTO reply_context_sends (context_id, channel, email_message_id) VALUES ($1, 'email', $2)`, [contextId, id]).catch(() => {})
}
