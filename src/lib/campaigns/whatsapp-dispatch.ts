import { queryOne } from '@/lib/shared/db'
import { canSendMarketing, alreadySentForReference, recordSent } from '@/lib/shared/marketing'
import type { CampaignKind } from '@/lib/shared/marketing'
import { days } from '@/lib/campaigns/duration'
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

    const user = await queryOne<{ phone: string | null }>(`SELECT phone FROM users WHERE id = $1`, [userId])
    if (!user?.phone) return { ok: false, reason: 'no_phone' }

    // Admin-authored overrides for this campaign: a custom SMS line, and/or an explicitly chosen
    // approved WhatsApp template (registry key) with filled variable slots + optional header image.
    const campaignRow = await queryOne<{
      sms_template: string | null
      wa_template_sid: string | null
      wa_variables: Record<string, string> | null
      wa_header_image_url: string | null
      parameters: Record<string, unknown> | null
    }>(
      `SELECT sms_template, wa_template_sid, wa_variables, wa_header_image_url, parameters FROM campaigns WHERE kind = $1`,
      [kind]
    ).catch(() => null)

    // Respect marketing opt-out (same gate as email campaigns).
    const gate = await canSendMarketing(userId, kind as CampaignKind)
    if (!gate.ok) return { ok: false, reason: gate.reason || 'opted_out' }

    // Dedup the WhatsApp send independently of email: a 'wa:<kind>' reference in email_campaigns_sent,
    // windowed by the campaign cooldown (MINUTES). Default to 1 day when unknown so a bug can never fan
    // out unbounded again. Record BEFORE sending so a crash mid-send can't cause a resend storm.
    const waRef = `wa:${kind}`
    const window = typeof cooldownMin === 'number' && cooldownMin > 0 ? cooldownMin : days(1)
    if (await alreadySentForReference(kind as CampaignKind, userId, waRef, window)) {
      return { ok: false, reason: 'cooldown' }
    }
    const waSentId = await recordSent({ campaignKind: kind as CampaignKind, userId, referenceId: waRef, channel: 'whatsapp' }).catch(
      () => null
    )

    // Product names can carry stray whitespace ("Earthing Rod ?" in the SMS).
    const clean = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as CampaignWaVars

    // Admin-chosen approved template takes precedence over the built-in per-kind dispatch. The
    // registry maps the chosen key → the env Content SID; variable slots were filled by the admin.
    let ok: boolean
    const waKey = campaignRow?.wa_template_sid
    if (waKey) {
      const { getWhatsAppTemplate } = await import('@/lib/templates/whatsapp-registry')
      const def = getWhatsAppTemplate(waKey)
      if (def) {
        const { sendCampaignTemplateWhatsApp } = await import('@/lib/shared/whatsapp')
        // Resolve the admin's slot values + header image through the send vars, so {firstName} →
        // the recipient's name and {productImageUrl} → the subject product's image (same pipeline as
        // SMS/email). Raw values were being sent literally. (#campaign templates)
        const rawVars = (campaignRow?.wa_variables as Record<string, string>) || {}
        const resolvedVars: Record<string, string> = {}
        for (const [k, v] of Object.entries(rawVars)) resolvedVars[k] = renderSmsTemplate(String(v ?? ''), clean)
        // Click-track the CTA link slot: wrap the resolved http(s) URL in the shared click redirect so
        // the delivered link records a click (keyed to this WhatsApp send) then forwards to the store.
        if (def.urlSlot != null && waSentId) {
          const raw = resolvedVars[String(def.urlSlot)]
          if (raw && /^https?:\/\//i.test(raw)) {
            const { buildClickTrackingUrl } = await import('@/lib/shared/marketing')
            const { apiBaseUrl } = await import('@/lib/shared/customer-links')
            resolvedVars[String(def.urlSlot)] = buildClickTrackingUrl(waSentId, raw, await apiBaseUrl())
          }
        }
        const resolvedImage = campaignRow?.wa_header_image_url
          ? renderSmsTemplate(campaignRow.wa_header_image_url, clean)
          : null
        ok = await sendCampaignTemplateWhatsApp({
          phone: user.phone,
          sidEnvVar: def.sidEnv,
          variables: resolvedVars,
          headerImageUrl: resolvedImage,
          imageSlot: def.imageSlot ?? null,
          kind,
          entity: { entityType: 'campaign', entityId: kind },
        })
      } else {
        ok = await dispatch(kind, user.phone, clean, { entityType: 'campaign', entityId: kind })
      }
    } else {
      ok = await dispatch(kind, user.phone, clean, { entityType: 'campaign', entityId: kind })
    }

    // Campaign SMS alongside WhatsApp — opt-in per campaign via the smsEnabled scenario param
    // (default off), mirroring whatsappEnabled. Transactional SMS (OTP/order) is unaffected.
    if (campaignRow?.parameters?.smsEnabled === true) {
      const smsBody = campaignRow?.sms_template?.trim()
        ? renderSmsTemplate(campaignRow.sms_template, clean)
        : campaignSmsBody(kind, clean)
      if (smsBody) {
        const { sendCampaignSMS } = await import('@/lib/shared/sms')
        sendCampaignSMS({ phone: user.phone, body: smsBody, kind, userId }).catch(() => {})
      }
    }

    return { ok, reason: ok ? undefined : 'send_failed' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// Scenarios pass the bare percent ("10"), which read as "for 10." in the SMS.
function smsDiscount(discount: string): string {
  return /^\d+(\.\d+)?$/.test(discount.trim()) ? `${discount.trim()}% off` : discount
}

// Render an admin-authored SMS template: {token} / {{token}} filled from the campaign vars, unknown
// tokens dropped. Plain text only (SMS has no markup). Collapses whitespace from removed tokens.
function renderSmsTemplate(template: string, vars: CampaignWaVars): string {
  return template
    .replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (_m, key: string) => {
      const v = (vars as Record<string, unknown>)[key]
      return v == null ? '' : String(v)
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
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
