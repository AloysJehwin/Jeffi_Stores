import { randomUUID } from 'node:crypto'
import type { SendMessageRequest, Channel } from '@jeffi/api-contracts'
import { mediaPriceInr, messagePriceInr } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import { db, one } from './db.js'
import { findTemplate } from './templates.js'
import * as tpl from './templates-v2.js'
import { poolsForTenant } from './pools.js'
import * as gov from './governance.js'
import { render, missingKeys, type Vars } from './render.js'
import { sendEmail } from './providers/email.js'
import { sendSms, sendWhatsApp } from './providers/twilio.js'
import { wrapEmail } from './mail-shell.js'
import { hostUrl, MediaError } from './media.js'

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
  space?: tpl.Space
}

// v2 library (tenant copy → platform default) first; legacy message_templates as fallback.
export async function resolveTemplate(tenantId: string, channel: string, slug: string, space: tpl.Space = 'store') {
  const { pools } = await poolsForTenant(tenantId)
  let t = await tpl.findBySlugWithDefaults(pools, tenantId, channel, slug, 'en', space)
  // Jeffi's controls for API customers: only allowed standard templates; reviewed versions only.
  if (t && space === 'api' && tenantId !== tpl.PLATFORM_TENANT_ID) {
    const s = await gov.getSettings(tenantId)
    if (t.family.tenant_id === tpl.PLATFORM_TENANT_ID && !gov.standardAllowed(s, channel, slug))
      throw new SendError(404, 'template_not_available', `The ${channel} template '${slug}' is not enabled for this workspace`)
    const v = t.variant as any
    if (t.family.tenant_id !== tpl.PLATFORM_TENANT_ID && v.review_status !== 'approved') {
      if (!v.approved_version_id) throw new SendError(422, 'template_pending_review', `'${slug}' is waiting for Jeffi's review and has no approved version yet`)
      const approved = await pools.tenant.query(`SELECT * FROM template_version WHERE id=$1`, [v.approved_version_id]).then(r => r.rows[0])
      if (approved) t = { ...t, version: approved }
    }
  }
  // WhatsApp only delivers approved templates: a tenant copy that isn't approved yet falls back to the
  // standard approved one, and an edited-but-unapproved version sends the approved text it replaces.
  if (channel === 'whatsapp' && t && !t.variant.provider_ref && tenantId !== tpl.PLATFORM_TENANT_ID)
    t = (await tpl.findBySlug(pools.platform, tpl.PLATFORM_TENANT_ID, channel, slug)) ?? t
  if (t?.version) {
    const pool = t.family.tenant_id === tpl.PLATFORM_TENANT_ID ? pools.platform : pools.tenant
    const live = channel === 'whatsapp' && t.variant.provider_ref
      ? (await tpl.liveVersion(pool, t.variant.id, t.variant.provider_ref)) ?? t.version
      : t.version
    return { subject: live.subject, body: live.body, provider_ref: t.variant.provider_ref ?? undefined, blocks: live.blocks as any, layout: live.layout }
  }
  return findTemplate(tenantId, channel, slug)
}

// WhatsApp templates with a header image `<prefix>{{n}}` and/or a URL button `<host>/{{m}}`: callers may
// pass media_url / button_url instead of the raw path and link code. A media_url outside the approved prefix
// (any host, any image format) is re-hosted on our CDN first, which is charged as media.
const PH = /\{\{\s*(\d+)\s*\}\}/
const mediaErr = (e: unknown): never => { throw e instanceof MediaError ? new SendError(e.status, e.code, e.message) : e }
async function actionVars(ctx: Ctx, blocks: any, vars: Vars, req: SendMessageRequest): Promise<{ vars: Vars; mediaHosted: boolean }> {
  const out: Vars = {}
  let mediaHosted = false
  const media: string = blocks?.types?.['twilio/media']?.media?.[0] ?? ''
  const mediaSlot = media.match(PH)?.[1]
  if (mediaSlot && !vars[mediaSlot]) {
    const prefix = media.slice(0, media.search(PH))
    if (!req.media_url) throw new SendError(422, 'missing_variables', `This template has an image header — pass media_url (an image under ${prefix}) or variables.${mediaSlot}`, { missing: [mediaSlot] })
    let url = req.media_url
    if (!url.startsWith(prefix)) {
      const h = await hostUrl(url, prefix).catch(e => {
        if (e instanceof MediaError) mediaErr(e)
        throw new SendError(422, 'media_host_unsupported', `This template's header must be under ${prefix}, which is not our media CDN — pass a link under it`)
      })
      url = h.url
      mediaHosted = h.fresh
      if (!url.startsWith(prefix)) throw new SendError(500, 'media_host_mismatch', `Re-hosted media is not under ${prefix}`)
    }
    out[mediaSlot] = url.slice(prefix.length)
  }
  const button = (blocks?.buttons ?? []).find((b: any) => b.type === 'url' && PH.test(b.value ?? ''))
  const linkSlot = button?.value.match(PH)?.[1]
  if (linkSlot && !vars[linkSlot]) {
    if (!req.button_url) throw new SendError(422, 'missing_variables', `This template has a link button — pass button_url or variables.${linkSlot}`, { missing: [linkSlot] })
    const code = randomUUID().replace(/-/g, '').slice(0, 10)
    await db.query(`INSERT INTO short_link (code, tenant_id, destination_url, kind) VALUES ($1,$2,$3,'page')`, [code, ctx.tenantId, req.button_url])
    out[linkSlot] = code
  }
  return { vars: out, mediaHosted }
}

// The insert variables every template can use without the caller passing them: store details, the
// store's custom variables, date/year and recipient fallbacks. The caller's own values always win.
const sysCache = new Map<string, { at: number; vars: Vars }>()
export async function systemVars(tenantId: string): Promise<Vars> {
  const hit = sysCache.get(tenantId)
  if (hit && Date.now() - hit.at < 60_000) return hit.vars
  const pools = await poolsForTenant(tenantId).then(p => p.pools).catch(() => null)
  // Missing tables / DB hiccup: fall back to the defaults rather than failing the send.
  const q = async <T>(sql: string, args: unknown[] = []) => { try { return (await pools!.tenant.query(sql, args)).rows as T[] } catch { return [] as T[] } }
  const [settings, custom, tenant] = await Promise.all([
    q<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key IN ('business_name','business_email','business_phone','business_web')`),
    q<{ key: string; value: string }>(`SELECT key, value FROM template_variables WHERE is_enabled`),
    db.query<{ display_name: string }>(`SELECT display_name FROM tenants WHERE id=$1`, [tenantId]).then(r => r.rows[0]).catch(() => undefined),
  ])
  const set = Object.fromEntries(settings.map(r => [r.key, r.value]))
  const vars: Vars = {
    ...Object.fromEntries(custom.map(c => [c.key, c.value ?? ''])),
    store_name: set.business_name || tenant?.display_name || '',
    store_email: set.business_email || '',
    store_phone: set.business_phone || '',
    store_web: set.business_web || '',
    current_year: String(new Date().getFullYear()),
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    customer_first_name: 'there',
    customer_name: 'there',
    customer_last_name: '',
  }
  sysCache.set(tenantId, { at: Date.now(), vars })
  return vars
}

/** Resolve template + variables into the final subject/body. */
async function compose(ctx: Ctx, req: SendMessageRequest) {
  const given = (req.variables ?? {}) as Vars
  const vars: Vars = {
    ...(await systemVars(ctx.tenantId)),
    ...(req.channel === 'email' ? { customer_email: req.to } : {}),
    ...(given.customer_first_name && !given.customer_name ? { customer_name: given.customer_first_name } : {}),
    ...given,
  }
  let subject = req.subject ?? null
  let body = req.body ?? ''
  let providerRef: string | undefined = req.provider_ref
  let layout: 'store' | 'none' = 'store'
  let mediaHosted = false
  if (req.template) {
    const t = await resolveTemplate(ctx.tenantId, req.channel, req.template, ctx.space)
    if (!t) throw new SendError(404, 'template_not_found', `No ${req.channel} template '${req.template}'`)
    const missing = missingKeys(t.body + ' ' + (t.subject ?? ''), vars)
    if (missing.length) throw new SendError(422, 'missing_variables', `Template needs: ${missing.join(', ')}`, { missing })
    subject = subject ?? t.subject
    body = t.body
    providerRef = providerRef ?? t.provider_ref ?? undefined
    layout = (t as any).layout === 'none' ? 'none' : 'store'
    if (req.channel === 'whatsapp') {
      const action = await actionVars(ctx, (t as any).blocks, vars, req)
      Object.assign(vars, action.vars)
      mediaHosted = action.mediaHosted
    }
  }
  const html = req.channel === 'email'
  return { subject: subject ? render(subject, vars) : null, body: render(body, vars, html), providerRef, vars, layout, mediaHosted }
}

export async function sendMessage(ctx: Ctx, req: SendMessageRequest): Promise<MessageRow> {
  const { subject, body, providerRef, vars, layout, mediaHosted } = await compose(ctx, req)
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
  if (mediaHosted) {
    const mediaInr = mediaPriceInr(ctx.internal)
    const m = await wallet.debit({ tenantId: ctx.tenantId, amountInr: mediaInr, category: 'media', externalRef: `media:${id}`, note: `media re-hosted for ${req.to}` })
    if (!m.ok) {
      await wallet.trueUp({ tenantId: ctx.tenantId, amountInr: 0, externalRef: `pub:${id}`, note: 'refund: media not covered' })
      await db.query(`UPDATE messages SET status='skipped', error=$2, updated_at=now() WHERE id=$1`, [id, 'insufficient_balance'])
      throw new SendError(402, 'insufficient_balance', `Wallet balance ₹${m.balance.toFixed(2)} is below the ₹${mediaInr.toFixed(2)} needed for the image. Top up ₹${m.needed.toFixed(2)}.`)
    }
  }

  try {
    let provider = 'twilio'
    let ref: string
    if (req.channel === 'email') {
      provider = 'ses'
      // layout 'none': the template's HTML exactly as written, no store header/footer.
      const html = layout === 'none' ? body : wrapEmail(body, { brand: req.brand, kicker: req.kicker, footerContact: req.footer_contact })
      ref = await sendEmail({ to: req.to, from: from!, subject: subject!, html })
    } else if (req.channel === 'sms') {
      ref = await sendSms({ to: req.to, body, messageId: id })
    } else {
      // Twilio content variables are the numbered slots only.
      const variables = Object.fromEntries(Object.entries(vars).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [k, String(v ?? '')]))
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
    if (mediaHosted) await wallet.trueUp({ tenantId: ctx.tenantId, amountInr: 0, externalRef: `media:${id}`, note: 'refund: media for a failed send' })
    await db.query(`UPDATE messages SET status='failed', error=$2, charged_inr=0, updated_at=now() WHERE id=$1`, [id, String(e?.message ?? e).slice(0, 500)])
    await db.query(`INSERT INTO message_events (message_id, event, payload) VALUES ($1,'failed',$2)`, [id, { error: String(e?.message ?? e) }])
  }
  return (await one<MessageRow>(`SELECT * FROM messages WHERE id=$1`, [id]))!
}

export function getMessage(tenantId: string, id: string) {
  return one<MessageRow>(`SELECT * FROM messages WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
}
