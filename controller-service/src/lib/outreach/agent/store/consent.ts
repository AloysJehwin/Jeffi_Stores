import { queryMany } from '@/lib/shared/db'
import { phone10, phoneMatchSql } from '@/lib/orders/by-phone'
import { withFlagshipStore } from './context'

export interface ShopperConsent {
  userId: string | null
  marketingOptOut: boolean
  /** The shopper chose WhatsApp for order updates (users.notification_channel = 'whatsapp'). */
  whatsappOptIn: boolean
}

/**
 * Consent facts for a flagship shopper, by phone. The account is the verified one when several share the number.
 * marketingOptOut is true if ANY account on that number opted out (the conservative reading).
 */
export async function shopperConsent(phone: string): Promise<ShopperConsent> {
  const p = phone10(phone)
  if (p.length < 10) return { userId: null, marketingOptOut: false, whatsappOptIn: false }
  const rows = await withFlagshipStore(() =>
    queryMany<{ id: string; marketing_opt_out: boolean; notification_channel: string | null }>(
      `SELECT id::text, marketing_opt_out, notification_channel FROM users
        WHERE ${phoneMatchSql('phone', '$1')} AND is_active = TRUE
        ORDER BY phone_verified DESC, is_guest ASC, created_at DESC LIMIT 5`,
      [p]
    )
  )
  const main = rows[0]
  return {
    userId: main?.id ?? null,
    marketingOptOut: rows.some(r => r.marketing_opt_out),
    whatsappOptIn: main?.notification_channel === 'whatsapp',
  }
}
