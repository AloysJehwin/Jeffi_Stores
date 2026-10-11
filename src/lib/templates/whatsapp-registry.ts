// Client-safe catalogue of the Meta-approved WhatsApp (Twilio Content) templates a campaign may use.
// WhatsApp bodies cannot be freely authored — Meta must approve each template — so the admin PICKS one,
// fills its numbered variable slots ({{1}},{{2}}…) and optionally supplies a header image (only for
// templates whose approved design has a media header). `bodyPreview` mirrors the approved copy so the UI
// can render a chat-bubble preview with the slots filled; it is NOT what Twilio sends (Twilio sends by
// contentSid). Add a template here once it's approved in Twilio/Meta — see docs/WHATSAPP_TEMPLATES.md.
export interface WhatsAppTemplateDef {
  /** Stable key stored on the campaign (resolved to a Twilio Content SID at send time via env). */
  key: string
  label: string
  /** Env var holding the live Content SID (so SIDs aren't hardcoded in the client bundle). */
  sidEnv: string
  /** Campaign kinds this template is appropriate for (subset of CAMPAIGN_WA_KINDS). */
  kinds: string[]
  /** Numbered slots in Meta order; `var` maps to an insert-variable the admin fills. */
  slots: { index: number; label: string }[]
  /** If the approved design has a media/image header, the {{n}} variable index that carries the media
   *  URL (Twilio fills the template's media component from contentVariables[imageSlot]). Absent = no
   *  media header. The real index is defined when the template is built in Twilio — see the doc. */
  imageSlot?: number
  /** Approved copy with {{1}} placeholders, for the chat-bubble preview only. */
  bodyPreview: string
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplateDef[] = [
  {
    key: 'abandoned_cart',
    label: 'Abandoned cart',
    sidEnv: 'TWILIO_WA_ABANDONED_CART_SID',
    kinds: ['abandoned_cart', 'abandoned_checkout', 'high_value_cart', 'cart_price_drop'],
    slots: [{ index: 1, label: 'Items / summary' }],
    bodyPreview: 'You left {{1}} in your cart. Complete your order before it sells out!',
  },
  {
    key: 'promo_offer',
    label: 'Promo / offer',
    sidEnv: 'TWILIO_WA_PROMO_OFFER_SID',
    kinds: ['winback_90', 'winback_180', 'first_purchase_nudge', 'second_purchase_nudge', 'signup_anniversary', 'loyalty_tier_upgrade', 'loyalty_points_reminder'],
    slots: [
      { index: 1, label: 'Offer / discount' },
      { index: 2, label: 'Code or link' },
    ],
    imageSlot: 3,
    bodyPreview: 'Special offer just for you: {{1}}. Use {{2}} to redeem.',
  },
  {
    key: 'back_in_stock',
    label: 'Back in stock',
    sidEnv: 'TWILIO_WA_BACK_IN_STOCK_SID',
    kinds: ['restock', 'back_in_stock_wishlist', 'price_drop', 'wishlist_reminder', 'viewed_product'],
    slots: [{ index: 1, label: 'Product name' }],
    imageSlot: 2,
    bodyPreview: '{{1}} is back in stock! Grab it before it runs out again.',
  },
  {
    key: 'new_arrivals',
    label: 'New arrivals',
    sidEnv: 'TWILIO_WA_NEW_ARRIVALS_SID',
    kinds: ['viewed_category', 'replenishment'],
    slots: [{ index: 1, label: 'Items / highlights' }],
    imageSlot: 2,
    bodyPreview: 'Just in: {{1}}. Be the first to shop the new drop.',
  },
  {
    key: 'reorder_reminder',
    label: 'Reorder reminder',
    sidEnv: 'TWILIO_WA_REORDER_REMINDER_SID',
    kinds: ['replenishment', 'subscription_renewal', 'post_purchase'],
    slots: [{ index: 1, label: 'Product name' }],
    bodyPreview: 'Running low on {{1}}? Reorder in a tap.',
  },
  {
    key: 'festive_greeting',
    label: 'Festive greeting',
    sidEnv: 'TWILIO_WA_FESTIVE_GREETING_SID',
    kinds: ['birthday', 'signup_anniversary'],
    slots: [{ index: 1, label: 'Greeting / name' }],
    imageSlot: 2,
    bodyPreview: 'Happy {{1}}! Celebrate with a little something from us.',
  },
  {
    key: 'feedback_request',
    label: 'Feedback request',
    sidEnv: 'TWILIO_WA_FEEDBACK_REQUEST_SID',
    kinds: ['review_request', 'review_reminder', 'review_photo_followup', 'post_purchase'],
    slots: [
      { index: 1, label: 'Order number' },
      { index: 2, label: 'Review link' },
    ],
    bodyPreview: 'How was order {{1}}? Share a quick review: {{2}}',
  },
]

const BY_KEY = new Map(WHATSAPP_TEMPLATES.map(t => [t.key, t]))

export function getWhatsAppTemplate(key: string | null | undefined): WhatsAppTemplateDef | null {
  return (key && BY_KEY.get(key)) || null
}

/** Templates offered for a given campaign kind. */
export function whatsAppTemplatesForKind(kind: string): WhatsAppTemplateDef[] {
  return WHATSAPP_TEMPLATES.filter(t => t.kinds.includes(kind))
}

/** Fill {{1}}/{{2}} placeholders in the preview copy from a {"1": "...", "2": "..."} map. */
export function renderWhatsAppPreview(def: WhatsAppTemplateDef, vars: Record<string, string>): string {
  return def.bodyPreview.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => vars[n] || `{{${n}}}`)
}
