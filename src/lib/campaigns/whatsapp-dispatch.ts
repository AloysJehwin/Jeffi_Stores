import { queryOne } from '@/lib/db'
import { canSendMarketing } from '@/lib/marketing'
import type { CampaignKind } from '@/lib/marketing'
import { CAMPAIGN_WA_KINDS, campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'
import {
  sendAbandonedCartWhatsApp,
  sendBackInStockWhatsApp,
  sendPromoOfferWhatsApp,
  sendFeedbackRequestWhatsApp,
} from '@/lib/whatsapp'

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
  vars: CampaignWaVars
): Promise<CampaignWaResult> {
  try {
    if (!campaignSupportsWhatsApp(kind)) return { ok: false, reason: 'unsupported_kind' }

    const user = await queryOne<{ phone: string | null }>(`SELECT phone FROM users WHERE id = $1`, [userId])
    if (!user?.phone) return { ok: false, reason: 'no_phone' }

    // Respect marketing opt-out (same gate as email campaigns).
    const gate = await canSendMarketing(userId, kind as CampaignKind)
    if (!gate.ok) return { ok: false, reason: gate.reason || 'opted_out' }

    const ok = await dispatch(kind, user.phone, vars, { entityType: 'campaign', entityId: kind })
    return { ok, reason: ok ? undefined : 'send_failed' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
