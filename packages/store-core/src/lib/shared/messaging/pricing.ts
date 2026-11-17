import type { WalletCategory } from '@/lib/payments/wallet'
import { messagePricing, usdInr } from '@jeffi/pricing'

export type MessagingChannel = 'sms' | 'whatsapp' | 'email'

// Send-time estimate per channel (INR) — used for the pre-send balance check and as the email charge
// (email has no delivery callback). SMS/WhatsApp are trued-up to the exact provider price on the
// status callback. Rough: Twilio India SMS ~$0.083 ≈ ₹7; WhatsApp marketing ~₹1; email ~free.
export const MESSAGING_ESTIMATE_INR: Record<MessagingChannel, number> = {
  sms: 7,
  whatsapp: 1,
  email: 0.05,
}

/** Twilio prices are USD; the wallet is INR. Converts at the live rate (loaded with loadMessagePricing). */
export function usdToInr(usd: number): number {
  return Math.round(Math.abs(usd) * usdInr() * 10000) / 10000
}

/** Send-time estimate at cost from the pricing sheet (provider defaults to Twilio); load it with loadMessagePricing. */
export function estimateFor(channel: MessagingChannel, provider?: string | null): number {
  const rates = messagePricing().rates
  const r = channel === 'email' ? rates['ses:email'] : rates[`${provider || 'twilio'}:${channel}`] ?? rates[`twilio:${channel}`]
  return r?.costInr ?? MESSAGING_ESTIMATE_INR[channel]
}

export function channelCategory(channel: MessagingChannel): WalletCategory {
  return channel
}
