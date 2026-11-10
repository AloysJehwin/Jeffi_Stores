// Client-safe shape of a Messaging email: a library template, or one written in the composer itself.

export interface EmailAttachment {
  url: string
  name: string
  size: number
  mime: string
}

export interface MessagingEmail {
  /** Library template (mode 'template'). */
  slug?: string
  mode?: 'template' | 'custom'
  vars?: Record<string, string>
  subject?: string
  preheader?: string
  /** Layout key (classic, bold, … or 'none'); empty follows the template's own setting. */
  layout?: string
  /** Written here (mode 'custom'). */
  format?: 'richtext' | 'blocks'
  body?: string
  blocks?: unknown[]
  attachments?: EmailAttachment[]
  reply_to?: string
}

export type BroadcastCoupon = { code: string; discount_type: string; discount_value: number | string }

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

export const isCustomEmail = (e?: MessagingEmail | null) => e?.mode === 'custom'

export function hasEmailContent(e?: MessagingEmail | null): boolean {
  if (!e) return false
  if (!isCustomEmail(e)) return !!e.slug
  return e.format === 'blocks' ? Array.isArray(e.blocks) && e.blocks.length > 0 : !!e.body?.replace(/<[^>]+>/g, '').trim()
}

/** The layout an email goes out in: the admin's pick, else the template's own setting. */
export function emailLayoutKey(e: MessagingEmail, templateLayout?: 'store' | 'none' | null): string {
  if (e.layout) return e.layout
  return !isCustomEmail(e) && templateLayout === 'none' ? 'none' : 'classic'
}

export function couponLabel(c: BroadcastCoupon): string {
  const v = Number(c.discount_value)
  return c.discount_type === 'percentage' ? `${v}% off` : `₹${v.toLocaleString('en-IN')} off`
}

/** Per-recipient values the message's own copy can use: {firstName}, {couponCode}, {discountLabel}… */
export function broadcastScenario(firstName: string | null | undefined, coupon: BroadcastCoupon | null, own?: Record<string, string>): Record<string, string> {
  return {
    firstName: firstName || 'there',
    ...(coupon
      ? {
          couponCode: coupon.code,
          discountPercent: coupon.discount_type === 'percentage' ? String(coupon.discount_value) : '',
          discountLabel: couponLabel(coupon),
        }
      : {}),
    ...(own ?? {}),
  }
}
