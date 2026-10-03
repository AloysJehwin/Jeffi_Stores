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
      if (!vars.items) return false
      return sendAbandonedCartWhatsApp({ phone, items: vars.items, entity })
    case 'restock':
      if (!vars.product) return false
      return sendBackInStockWhatsApp({ phone, product: vars.product, entity })
    case 'winback_90':
    case 'winback_180':
    case 'price_drop':
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

    const ok = await dispatch(kind, user.phone, vars, { entityType: 'campaign', entityId: kind })

    // Mobile = both channels: fire a plain-text SMS alongside WhatsApp so a customer reached on
    // mobile gets it even if WhatsApp isn't delivered. Shares the one dedup above (no extra gate),
    // best-effort. (#campaign SMS+WhatsApp together)
    const smsBody = campaignSmsBody(kind, vars)
    if (smsBody) {
      const { sendCampaignSMS } = await import('@/lib/shared/sms')
      sendCampaignSMS({ phone: user.phone, body: smsBody, kind, userId }).catch(() => {})
    }

    return { ok, reason: ok ? undefined : 'send_failed' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

// A short SMS line per campaign kind, built from the same vars as the WhatsApp template. Returns ''
// to skip SMS for kinds without a sensible short form.
function campaignSmsBody(kind: string, vars: CampaignWaVars): string {
  switch (kind) {
    case 'abandoned_cart':
    case 'abandoned_checkout':
      return vars.items ? `You left ${vars.items} in your cart. Complete your order before it's gone.` : ''
    case 'viewed_product':
      return vars.items ? `Still thinking about ${vars.items}? Take another look before it's gone.` : ''
    case 'restock':
      return vars.product ? `${vars.product} is back in stock. Grab it before it sells out.` : ''
    case 'winback_90':
    case 'winback_180':
    case 'price_drop':
      return vars.code
        ? `${vars.headline || 'A special offer for you'} — use code ${vars.code}${vars.discount ? ` for ${vars.discount}` : ''}.`
        : vars.headline || ''
    case 'review_request':
    case 'review_reminder':
    case 'post_purchase':
      return vars.orderNumber && vars.url ? `How was order ${vars.orderNumber}? Share a quick review: ${vars.url}` : ''
    default:
      return ''
  }
}
