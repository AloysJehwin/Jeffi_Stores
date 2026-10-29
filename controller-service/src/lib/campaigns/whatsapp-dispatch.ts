import { queryOne } from '@/lib/shared/db'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { bridgeVars } from '@/lib/templates/var-bridge'
import { canSendMarketing, alreadySentForReference, recordSent } from '@/lib/shared/marketing'
import type { CampaignKind } from '@/lib/shared/marketing'
import { days } from '@/lib/campaigns/duration'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { renderCampaignTemplate } from '@/lib/shared/automation-emails'
import { getLibraryTemplate } from '@/lib/messaging/library'
import { fillActionSlots, plainSlug } from '@/lib/messaging/action-slots'
import { sendByTemplate } from '@/lib/shared/send-by-template'
import { logMessage } from '@/lib/shared/message-log'
import { CAMPAIGN_WA_KINDS, campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'
import {
  sendAbandonedCartWhatsApp,
  sendBackInStockWhatsApp,
  sendPromoOfferWhatsApp,
  sendFeedbackRequestWhatsApp,
} from '@/lib/shared/whatsapp'

// Campaign → WhatsApp bridge. Fire-and-forget from a scenario's send() when
// params.whatsappEnabled is true. Sends the kind's mapped template to the
// customer's phone (if any), respecting marketing opt-out, and tags the send
// with entity_type='campaign' / entity_id=<kind> so the campaign detail page
// can show a per-campaign WhatsApp log. Never throws.
//
// The client-safe kind list + guard live in ./whatsapp-kinds (no server imports),
// re-exported here for existing importers.
export { CAMPAIGN_WA_KINDS, campaignSupportsWhatsApp }

export type CampaignWaResult = { ok: boolean; reason?: string }

export interface CampaignWaVars {
  items?: string // abandoned_cart / abandoned_checkout
  product?: string // restock
  headline?: string // winback / price_drop
  code?: string
  discount?: string
  orderNumber?: string // review / post_purchase
  url?: string // feedback URL / the campaign's link (WhatsApp button)
  imageUrl?: string // product photo (WhatsApp image header)
}

async function dispatch(
  kind: string,
  phone: string,
  vars: CampaignWaVars,
  entity: { entityType: string; entityId: string }
): Promise<boolean> {
  switch (kind) {
    case 'abandoned_cart':
    case 'abandoned_checkout':
    case 'viewed_product':
    case 'viewed_category':
    case 'high_value_cart':
    case 'cart_price_drop':
    case 'wishlist_reminder':
    case 'replenishment':
    case 'subscription_renewal':
      if (!vars.items) return false
      return sendAbandonedCartWhatsApp({ phone, items: vars.items, entity })
    case 'restock':
    case 'review_photo_followup':
    case 'back_in_stock_wishlist':
      if (!vars.product) return false
      return sendBackInStockWhatsApp({ phone, product: vars.product, entity })
    case 'winback_90':
    case 'winback_180':
    case 'price_drop':
    case 'first_purchase_nudge':
    case 'second_purchase_nudge':
    case 'signup_anniversary':
    case 'loyalty_tier_upgrade':
    case 'loyalty_points_reminder':
    case 'referral_invite':
    case 'birthday':
      return sendPromoOfferWhatsApp({
        phone,
        headline: vars.headline || 'A special offer for you',
        code: vars.code || '',
        discount: vars.discount || '',
        entity,
      })
    case 'review_request':
    case 'review_reminder':
    case 'post_purchase':
      if (!vars.orderNumber || !vars.url) return false
      return sendFeedbackRequestWhatsApp({ phone, orderNumber: vars.orderNumber, url: vars.url, entity })
    default:
      return false
  }
}

/** The values a campaign's WhatsApp/SMS text is rendered with (recipient + store + scenario, under every alias). */
export async function campaignMessageRenderer(
  vars: CampaignWaVars,
  user: { email: string | null; first_name: string | null; last_name: string | null }
) {
  // Product names can carry stray whitespace ("Earthing Rod ?" in the SMS).
  const clean = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
  ) as CampaignWaVars
  const registered = await resolveTemplateVariables({
    recipient: { email: user.email ?? '', first_name: user.first_name, last_name: user.last_name },
  })
  const full: Record<string, string> = Object.fromEntries(Object.entries({
    ...clean, firstName: user.first_name || 'there', productName: clean.product, couponCode: clean.code,
    discountPercent: clean.discount, ctaUrl: clean.url || (await storeBaseUrlAsync()), productImageUrl: clean.imageUrl,
    headline: clean.headline || 'A special offer for you',
  }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
  const render = (t: string) => renderCampaignTemplate(t, full, registered, false).replace(/[ \t]{2,}/g, ' ').trim()
  // Variables a template needs that this campaign can't fill (blocks behind a false {#if} don't count).
  const known: Record<string, string> = { ...registered, ...bridgeVars(full) }
  const has = (k: string) => !!String(known[k] ?? '').trim()
  const missing = (t: string) => {
    const live = t.replace(/\{#if\s+(\w+)\}([\s\S]*?)\{\/if\}/g, (_m, c, inner) => (has(c) ? inner : ''))
    return [...new Set([...live.matchAll(/\{\{?\s*([a-zA-Z_]\w*)\s*\}?\}/g)].map(m => m[1]).filter(k => !has(k)))]
  }
  return { clean, full, registered, render, missing }
}

export async function sendCampaignWhatsApp(
  kind: string,
  userId: string,
  vars: CampaignWaVars,
  // Per-user cooldown (MINUTES). Without this, the campaign re-sent WhatsApp every cron run to every
  // still-eligible user — 55k messages / 192-per-number-per-day for ~155 carts. The WhatsApp send
  // now records its own dedup marker and refuses to resend within the window. (#campaign over-send)
  cooldownMin?: number | null
): Promise<CampaignWaResult> {
  try {
    if (!campaignSupportsWhatsApp(kind)) return { ok: false, reason: 'unsupported_kind' }

    const user = await queryOne<{ phone: string | null; email: string | null; first_name: string | null; last_name: string | null }>(
      `SELECT phone, email, first_name, last_name FROM users WHERE id = $1`, [userId])
    if (!user?.phone) { console.warn(`[campaign-wa] ${kind} user=${userId} no_phone`); return { ok: false, reason: 'no_phone' } }

    const row = await queryOne<{
      sms_template: string | null; sms_template_slug: string | null
      wa_template_slug: string | null
      wa_variables: Record<string, string> | null
      parameters: Record<string, unknown> | null
    }>(
      `SELECT sms_template, sms_template_slug, wa_template_slug, wa_variables, parameters
         FROM campaigns WHERE kind = $1`, [kind]).catch(() => null)
    const params = row?.parameters ?? {}

    // Respect marketing opt-out (same gate as email campaigns).
    const gate = await canSendMarketing(userId, kind as CampaignKind, { phoneChannel: true })
    if (!gate.ok) { console.warn(`[campaign-wa] ${kind} user=${userId} gated: ${gate.reason}`); return { ok: false, reason: gate.reason || 'opted_out' } }

    const { clean, render, missing } = await campaignMessageRenderer(vars, user)
    const window = typeof cooldownMin === 'number' && cooldownMin > 0 ? cooldownMin : days(1)

    // Each channel dedups independently (wa:/sms:<kind> in email_campaigns_sent), recorded BEFORE sending
    // so a crash mid-send can't cause a resend storm.
    const claim = async (channel: 'whatsapp' | 'sms') => {
      const ref = `${channel === 'whatsapp' ? 'wa' : 'sms'}:${kind}`
      if (await alreadySentForReference(kind as CampaignKind, userId, ref, window)) return null
      return (await recordSent({ campaignKind: kind as CampaignKind, userId, referenceId: ref, channel }).catch(() => null)) ?? ''
    }

    let ok = false
    let attempted = false
    let deduped = false
    if (params.whatsappEnabled === true) {
      const waSentId = await claim('whatsapp')
      if (waSentId === null) deduped = true
      else { attempted = true; ok = await sendWhatsAppPart(kind, user.phone, row, clean, render, missing, waSentId) }
    }
    const smsClaim = params.smsEnabled === true ? await claim('sms') : undefined
    if (smsClaim === null) deduped = true
    if (smsClaim != null) {
      attempted = true
      let body = ''
      if (row?.sms_template_slug) body = (await getLibraryTemplate('sms', row.sms_template_slug))?.body ?? ''
      if (!body && row?.sms_template?.trim()) body = row.sms_template
      const gaps = body ? missing(body) : []
      if (gaps.length) console.warn(`[campaign-sms] ${kind}: template needs ${gaps.map(g => `{${g}}`).join(', ')} which this campaign can't fill — sending the built-in SMS`)
      body = body && !gaps.length ? render(body) : campaignSmsBody(kind, clean)
      if (body) {
        const { sendCampaignSMS } = await import('@/lib/shared/sms')
        ok = (await sendCampaignSMS({ phone: user.phone, body, kind, userId }).catch(() => false)) || ok
      }
    }
    const reason = ok ? undefined : !attempted && deduped ? 'cooldown' : 'send_failed'
    if (!ok) console.warn(`[campaign-wa] ${kind} user=${userId} ${reason} (wa=${params.whatsappEnabled === true} sms=${params.smsEnabled === true})`)
    return { ok, reason }
  } catch (e) {
    console.error(`[campaign-wa] ${kind} user=${userId} error:`, e)
    return { ok: false, reason: 'error' }
  }
}

// Site Controls WhatsApp toggle; the library-template path below calls sendByTemplate directly.
async function whatsappOn(): Promise<boolean> {
  try {
    const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
    return (await getFeatureFlags()).whatsappEnabled
  } catch {
    return process.env.WHATSAPP_DISABLED !== 'true'
  }
}

// WhatsApp: a linked library template (approved) with the admin's {{n}} values, else the built-in
// per-kind template.
async function sendWhatsAppPart(
  kind: string,
  phone: string,
  row: { wa_template_slug: string | null; wa_variables: Record<string, string> | null } | null,
  clean: CampaignWaVars,
  render: (t: string) => string,
  missing: (t: string) => string[],
  waSentId: string
): Promise<boolean> {
  if (!(await whatsappOn())) return false
  const entity = { entityType: 'campaign', entityId: kind }
  const { buildClickTrackingUrl } = await import('@/lib/shared/marketing')
  const { apiBaseUrl } = await import('@/lib/shared/customer-links')
  const track = async (v: string) => (waSentId && /^https?:\/\//i.test(v) ? buildClickTrackingUrl(waSentId, v, await apiBaseUrl()) : v)

  if (row?.wa_template_slug) {
    const t = await getLibraryTemplate('whatsapp', row.wa_template_slug)
    const slots = t ? [...new Set([...t.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => m[1]))] : []
    const raw = row.wa_variables ?? {}
    const gaps = [...new Set(slots.flatMap(n => (raw[n]?.trim() ? missing(raw[n]) : [])))]
    if (gaps.length) console.warn(`[campaign-wa] ${kind}: slots use ${gaps.map(g => `{${g}}`).join(', ')} which this campaign can't fill — sending the built-in WhatsApp`)
    if (t?.approval_status === 'approved' && slots.every(n => raw[n]?.trim()) && !gaps.length) {
      const variables: Record<string, string> = {}
      for (const n of slots) variables[n] = await track(render(raw[n]))
      // _action templates: product photo (else store banner) + tracked CTA link; none on the CDN → plain template.
      const extra = await fillActionSlots(t, { imageUrl: render('{productImageUrl}') || null, linkUrl: (await track(render('{ctaUrl}'))) || null })
      const slug = extra ? t.slug : plainSlug(t.slug)
      Object.assign(variables, extra ?? {})
      const res = await sendByTemplate({ channel: 'whatsapp', slug, to: phone, variables, reference: `campaign:${kind}` })
      const sent = res.status !== 'failed' && res.status !== 'skipped'
      const { getStoreIdentity } = await import('@/lib/catalog/site-controls')
      const storeName = await getStoreIdentity().then(s => s.name).catch(() => '')
      logMessage({ channel: 'whatsapp', to: phone, from: 'messaging-service', body: t.body.replace(/\{\{\s*brand_name\s*\}\}/g, storeName).replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => variables[n] ?? ''),
        kind, status: sent ? 'sent' : 'failed', error: res.error, providerSid: res.providerSid ?? res.id, provider: 'messaging-service', ...entity })
      return sent
    }
    // Not approved yet / slots not filled → the built-in template for this kind still goes out.
    return dispatch(kind, phone, clean, entity)
  }

  return dispatch(kind, phone, clean, entity)
}

// Scenarios pass the bare percent ("10"), which read as "for 10." in the SMS.
function smsDiscount(discount: string): string {
  return /^\d+(\.\d+)?$/.test(discount.trim()) ? `${discount.trim()}% off` : discount
}

// A short SMS line per campaign kind, built from the same vars as the WhatsApp template. Returns ''
// to skip SMS for kinds without a sensible short form.
function campaignSmsBody(kind: string, vars: CampaignWaVars): string {
  switch (kind) {
    case 'abandoned_cart':
    case 'abandoned_checkout':
    case 'high_value_cart':
      return vars.items ? `You left ${vars.items} in your cart. Complete your order before it's gone.` : ''
    case 'viewed_product':
    case 'viewed_category':
    case 'wishlist_reminder':
      return vars.items ? `Still thinking about ${vars.items}? Take another look before it's gone.` : ''
    case 'cart_price_drop':
      return vars.items ? `Good news — ${vars.items} in your cart just dropped in price.` : ''
    case 'replenishment':
    case 'subscription_renewal':
      return vars.items ? `Running low on ${vars.items}? Reorder in a tap.` : ''
    case 'restock':
    case 'back_in_stock_wishlist':
      return vars.product ? `${vars.product} is back in stock. Grab it before it sells out.` : ''
    case 'review_photo_followup':
      return vars.product ? `Add a photo to your ${vars.product} review and help other shoppers.` : ''
    case 'winback_90':
    case 'winback_180':
    case 'price_drop':
    case 'first_purchase_nudge':
    case 'second_purchase_nudge':
    case 'signup_anniversary':
    case 'loyalty_tier_upgrade':
    case 'loyalty_points_reminder':
    case 'referral_invite':
    case 'birthday':
      return vars.code
        ? `${vars.headline || 'A special offer for you'} — use code ${vars.code}${vars.discount ? ` for ${smsDiscount(vars.discount)}` : ''}.`
        : vars.headline || ''
    case 'review_request':
    case 'review_reminder':
    case 'post_purchase':
      return vars.orderNumber && vars.url ? `How was order ${vars.orderNumber}? Share a quick review: ${vars.url}` : ''
    default:
      return ''
  }
}
