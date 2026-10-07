import { queryOne } from '@/lib/shared/db'
import { canSendMarketing, alreadySentForReference, recordSent } from '@/lib/shared/marketing'
import type { CampaignKind } from '@/lib/shared/marketing'
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
  // Per-user cooldown (days). Without this, the campaign re-sent WhatsApp every cron run to every
  // still-eligible user — 55k messages / 192-per-number-per-day for ~155 carts. The WhatsApp send
  // now records its own dedup marker and refuses to resend within the window. (#campaign over-send)
  cooldownDays?: number | null
): Promise<CampaignWaResult> {
  try {
    if (!campaignSupportsWhatsApp(kind)) return { ok: false, reason: 'unsupported_kind' }

    const user = await queryOne<{ phone: string | null }>(`SELECT phone FROM users WHERE id = $1`, [userId])
    if (!user?.phone) return { ok: false, reason: 'no_phone' }

    // Respect marketing opt-out (same gate as email campaigns).
    const gate = await canSendMarketing(userId, kind as CampaignKind)
    if (!gate.ok) return { ok: false, reason: gate.reason || 'opted_out' }

    // Dedup the WhatsApp send independently of email: a 'wa:<kind>' reference in email_campaigns_sent,
    // windowed by the campaign cooldown. Default to 1 day when unknown so a bug can never fan out
    // unbounded again. Record BEFORE sending so a crash mid-send can't cause a resend storm.
    const waRef = `wa:${kind}`
    const window = typeof cooldownDays === 'number' && cooldownDays > 0 ? cooldownDays : 1
    if (await alreadySentForReference(kind as CampaignKind, userId, waRef, window)) {
      return { ok: false, reason: 'cooldown' }
    }
    await recordSent({ campaignKind: kind as CampaignKind, userId, referenceId: waRef }).catch(() => null)

    // Product names can carry stray whitespace ("Earthing Rod ?" in the SMS).
    const clean = Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as CampaignWaVars
    const ok = await dispatch(kind, user.phone, clean, { entityType: 'campaign', entityId: kind })

    // Mobile = both channels: fire a plain-text SMS alongside WhatsApp so a customer reached on
    // mobile gets it even if WhatsApp isn't delivered. Shares the one dedup above (no extra gate),
    // best-effort. (#campaign SMS+WhatsApp together)
    const smsBody = campaignSmsBody(kind, clean)
    if (smsBody) {
      const { sendCampaignSMS } = await import('@/lib/shared/sms')
      sendCampaignSMS({ phone: user.phone, body: smsBody, kind, userId }).catch(() => {})
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
