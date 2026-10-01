// Client-safe: which campaign kinds support WhatsApp. NO server imports here
// (no @/lib/shared/db) so client components can import it without pulling server code
// into the browser bundle.

export const CAMPAIGN_WA_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'restock',
  'winback_90',
  'winback_180',
  'price_drop',
  'review_request',
  'review_reminder',
  'post_purchase',
] as const

export function campaignSupportsWhatsApp(kind: string): boolean {
  return (CAMPAIGN_WA_KINDS as readonly string[]).includes(kind)
}
