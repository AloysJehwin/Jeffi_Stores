import { queryOne } from '@/lib/shared/db'
import { canSendMarketing, alreadySentForReference, recordSent } from '@/lib/shared/marketing'
import type { CampaignKind } from '@/lib/shared/marketing'
import { days } from '@/lib/campaigns/duration'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { renderCampaignTemplate } from '@/lib/shared/automation-emails'
import { getLibraryTemplate } from '@/lib/messaging/library'
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
  url?: string // feedback URL
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
    if (!user?.phone) return { ok: false, reason: 'no_phone' }

    const row = await queryOne<{
      sms_template: string | null; sms_template_slug: string | null
      wa_template_sid: string | null; wa_template_slug: string | null
      wa_variables: Record<string, string> | null; wa_header_image_url: string | null
      parameters: Record<string, unknown> | null
    }>(
      `SELECT sms_template, sms_template_slug, wa_template_sid, wa_template_slug, wa_variables, wa_header_image_url, parameters
         FROM campaigns WHERE kind = $1`, [kind]).catch(() => null)
    const params = row?.parameters ?? {}

    // Respect marketing opt-out (same gate as email campaigns).
    const gate = await canSendMarketing(userId, kind as CampaignKind)
    if (!gate.ok) return { ok: false, reason: gate.reason || 'opted_out' }

    // Product names can carry stray whitespace ("Earthing Rod ?" in the SMS).
    const clean = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as CampaignWaVars
    // Full variable set for library templates: recipient + store vars and the scenario values under
    // their campaign/library names (so {firstName} / {{coupon_code}} no longer render blank).
    const registered = await resolveTemplateVariables({
      recipient: { email: user.email ?? '', first_name: user.first_name, last_name: user.last_name },
    })
    const full: Record<string, string> = Object.fromEntries(Object.entries({
      ...clean, firstName: user.first_name || 'there', productName: clean.product, couponCode: clean.code,
      discountPercent: clean.discount, ctaUrl: clean.url, headline: clean.headline || 'A special offer for you',
    }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    const render = (t: string) => renderCampaignTemplate(t, full, registered, false).replace(/[ \t]{2,}/g, ' ').trim()
    const window = typeof cooldownMin === 'number' && cooldownMin > 0 ? cooldownMin : days(1)

    // Each channel dedups independently (wa:/sms:<kind> in email_campaigns_sent), recorded BEFORE sending
    // so a crash mid-send can't cause a resend storm.
    const claim = async (channel: 'whatsapp' | 'sms') => {
      const ref = `${channel === 'whatsapp' ? 'wa' : 'sms'}:${kind}`
      if (await alreadySentForReference(kind as CampaignKind, userId, ref, window)) return null
      return (await recordSent({ campaignKind: kind as CampaignKind, userId, referenceId: ref, channel }).catch(() => null)) ?? ''
    }

    let ok = false
    if (params.whatsappEnabled === true) {
      const waSentId = await claim('whatsapp')
      if (waSentId !== null) ok = await sendWhatsAppPart(kind, user.phone, row, clean, render, waSentId)
    }
    if (params.smsEnabled === true && (await claim('sms')) !== null) {
      let body = ''
      if (row?.sms_template_slug) body = (await getLibraryTemplate('sms', row.sms_template_slug))?.body ?? ''
      if (!body && row?.sms_template?.trim()) body = row.sms_template
      body = body ? render(body) : campaignSmsBody(kind, clean)
      if (body) {
        const { sendCampaignSMS } = await import('@/lib/shared/sms')
        ok = (await sendCampaignSMS({ phone: user.phone, body, kind, userId }).catch(() => false)) || ok
      }
    }
    return { ok, reason: ok ? undefined : 'send_failed' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// WhatsApp: a linked library template (approved) with the admin's {{n}} values, else the legacy
// registry pick, else the built-in per-kind template.
async function sendWhatsAppPart(
  kind: string,
  phone: string,
  row: { wa_template_sid: string | null; wa_template_slug: string | null; wa_variables: Record<string, string> | null; wa_header_image_url: string | null } | null,
  clean: CampaignWaVars,
  render: (t: string) => string,
  waSentId: string
): Promise<boolean> {
  const entity = { entityType: 'campaign', entityId: kind }
  const { buildClickTrackingUrl } = await import('@/lib/shared/marketing')
  const { apiBaseUrl } = await import('@/lib/shared/customer-links')
  const track = async (v: string) => (waSentId && /^https?:\/\//i.test(v) ? buildClickTrackingUrl(waSentId, v, await apiBaseUrl()) : v)

  if (row?.wa_template_slug) {
    const t = await getLibraryTemplate('whatsapp', row.wa_template_slug)
    const slots = t ? [...new Set([...t.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => m[1]))] : []
    const raw = row.wa_variables ?? {}
    if (t?.approval_status === 'approved' && slots.every(n => raw[n]?.trim())) {
      const variables: Record<string, string> = {}
      for (const n of slots) variables[n] = await track(render(raw[n]))
      const res = await sendByTemplate({ channel: 'whatsapp', slug: t.slug, to: phone, variables, reference: `campaign:${kind}` })
      const sent = res.status !== 'failed' && res.status !== 'skipped'
      logMessage({ channel: 'whatsapp', to: phone, from: 'messaging-service', body: t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => variables[n] ?? ''),
        kind, status: sent ? 'sent' : 'failed', error: res.error, providerSid: res.id, provider: 'messaging-service', ...entity })
      return sent
    }
    // Not approved yet / slots not filled → the built-in template for this kind still goes out.
    return dispatch(kind, phone, clean, entity)
  }

  if (row?.wa_template_sid) {
    const { getWhatsAppTemplate } = await import('@/lib/templates/whatsapp-registry')
    const def = getWhatsAppTemplate(row.wa_template_sid)
    if (def) {
      const { sendCampaignTemplateWhatsApp } = await import('@/lib/shared/whatsapp')
      const resolvedVars: Record<string, string> = {}
      for (const [k, v] of Object.entries(row.wa_variables ?? {})) resolvedVars[k] = render(String(v ?? ''))
      if (def.urlSlot != null && resolvedVars[String(def.urlSlot)]) resolvedVars[String(def.urlSlot)] = await track(resolvedVars[String(def.urlSlot)])
      return sendCampaignTemplateWhatsApp({
        phone, sidEnvVar: def.sidEnv, variables: resolvedVars,
        headerImageUrl: row.wa_header_image_url ? render(row.wa_header_image_url) : null,
        imageSlot: def.imageSlot ?? null, kind, entity,
      })
    }
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
