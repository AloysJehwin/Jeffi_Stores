import { randomUUID } from 'node:crypto'
import type { SendMessageRequest, Channel } from '@jeffi/api-contracts'
import { messagePriceInr } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import { db, one } from './db.js'
import { findTemplate } from './templates.js'
import { render, missingKeys, type Vars } from './render.js'
import { sendEmail } from './providers/email.js'
import { sendSms, sendWhatsApp } from './providers/twilio.js'
import { wrapEmail } from './mail-shell.js'

export class SendError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

export interface MessageRow {
  id: string
  tenant_id: string
  api_key_id: string | null
  batch_id: string | null
  channel: Channel
  to_address: string
  from_address: string | null
  template_slug: string | null
  subject: string | null
  body: string
  status: string
  provider: string | null
  provider_ref: string | null
  price_inr: string
  charged_inr: string
  error: string | null
  reference: string | null
  metadata: unknown
  created_at: string
  updated_at: string
}

export const toApi = (m: MessageRow) => ({
  id: m.id,
  channel: m.channel,
  to: m.to_address,
  template: m.template_slug,
  status: m.status,
  provider_ref: m.provider_ref,
  price_inr: Number(m.price_inr),
  charged_inr: Number(m.charged_inr),
  error: m.error,
  reference: m.reference,
  created_at: new Date(m.created_at).toISOString(),
  updated_at: new Date(m.updated_at).toISOString(),
})

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'

interface Ctx {
  tenantId: string
  tenantSlug?: string
  apiKeyId?: string
  batchId?: string
  internal?: boolean
}

/** Resolve template + variables into the final subject/body. */
async function compose(ctx: Ctx, req: SendMessageRequest) {
  const vars: Vars = (req.variables ?? {}) as Vars
  let subject = req.subject ?? null
  let body = req.body ?? ''
  let providerRef: string | undefined = req.provider_ref
  if (req.template) {
    const t = await findTemplate(ctx.tenantId, req.channel, req.template)
    if (!t) throw new SendError(404, 'template_not_found', `No ${req.channel} template '${req.template}'`)
    const missing = missingKeys(t.body + ' ' + (t.subject ?? ''), vars)
    if (missing.length) throw new SendError(422, 'missing_variables', `Template needs: ${missing.join(', ')}`, { missing })
    subject = subject ?? t.subject
    body = t.body
    providerRef = providerRef ?? t.provider_ref ?? undefined
  }
  const html = req.channel === 'email'
  return { subject: subject ? render(subject, vars) : null, body: render(body, vars, html), providerRef, vars }
}

export async function sendMessage(ctx: Ctx, req: SendMessageRequest): Promise<MessageRow> {
  const { subject, body, providerRef, vars } = await compose(ctx, req)
  if (req.channel === 'email' && !subject) throw new SendError(422, 'subject_required', 'Email needs a subject')

  const id = randomUUID()
  const priceInr = messagePriceInr(req.channel, ctx.internal)
  const from =
    req.from ?? (req.channel === 'email' ? `${ctx.tenantSlug ?? 'noreply'}@${PLATFORM_DOMAIN}` : null)

  await db.query(
    `INSERT INTO messages (id, tenant_id, api_key_id, batch_id, channel, to_address, from_address, template_slug, subject, body, price_inr, reference, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ctx.tenantId, ctx.apiKeyId ?? null, ctx.batchId ?? null, req.channel, req.to, from, req.template ?? null, subject, body, priceInr, req.reference ?? null, { ...(req.metadata ?? {}), internal: !!ctx.internal }]
  )

  // Wallet gate — debit before the provider call; idempotent on the message id.
  const debit = await wallet.debit({ tenantId: ctx.tenantId, amountInr: priceInr, category: req.channel, externalRef: `pub:${id}`, note: `${req.channel} → ${req.to}` })
  if (!debit.ok) {
    await db.query(`UPDATE messages SET status='skipped', error=$2, updated_at=now() WHERE id=$1`, [id, 'insufficient_balance'])
    throw new SendError(402, 'insufficient_balance', `Wallet balance ₹${debit.balance.toFixed(2)} is below the ₹${priceInr.toFixed(2)} needed. Top up ₹${debit.needed.toFixed(2)}.`)
  }

  try {
    let provider = 'twilio'
    let ref: string
    if (req.channel === 'email') {
      provider = 'ses'
      const html = wrapEmail(body, { brand: req.brand, kicker: req.kicker, footerContact: req.footer_contact })
      ref = await sendEmail({ to: req.to, from: from!, subject: subject!, html })
    } else if (req.channel === 'sms') {
      ref = await sendSms({ to: req.to, body, messageId: id })
    } else {
      const variables = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v ?? '')]))
      ref = await sendWhatsApp({ to: req.to, body, contentSid: providerRef, variables, messageId: id })
    }
    await db.query(
      `UPDATE messages SET status='sent', provider=$2, provider_ref=$3, charged_inr=$4, updated_at=now() WHERE id=$1`,
      [id, provider, ref, debit.charged ? priceInr : 0]
    )
    await db.query(`INSERT INTO message_events (message_id, event) VALUES ($1,'sent')`, [id])
  } catch (e: any) {
    // Provider failed: refund by truing the debit up to zero.
    await wallet.trueUp({ tenantId: ctx.tenantId, amountInr: 0, externalRef: `pub:${id}`, note: `refund: ${req.channel} failed` })
    await db.query(`UPDATE messages SET status='failed', error=$2, charged_inr=0, updated_at=now() WHERE id=$1`, [id, String(e?.message ?? e).slice(0, 500)])
    await db.query(`INSERT INTO message_events (message_id, event, payload) VALUES ($1,'failed',$2)`, [id, { error: String(e?.message ?? e) }])
  }
  return (await one<MessageRow>(`SELECT * FROM messages WHERE id=$1`, [id]))!
}

export function getMessage(tenantId: string, id: string) {
  return one<MessageRow>(`SELECT * FROM messages WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
}
