import type { WalletCategory } from '@/lib/payments/wallet'

export type MessagingChannel = 'sms' | 'whatsapp' | 'email'

// Send-time estimate per channel (INR) — used for the pre-send balance check and as the email charge
// (email has no delivery callback). SMS/WhatsApp are trued-up to the exact provider price on the
// status callback. Rough: Twilio India SMS ~$0.083 ≈ ₹7; WhatsApp marketing ~₹1; email ~free.
export const MESSAGING_ESTIMATE_INR: Record<MessagingChannel, number> = {
  sms: 7,
  whatsapp: 1,
  email: 0.05,
}

// Twilio prices are USD; the wallet is INR. Hardcoded rate (a live FX fetch is a future enhancement).
export const USD_INR_RATE = 88

export function usdToInr(usd: number): number {
  return Math.round(Math.abs(usd) * USD_INR_RATE * 10000) / 10000
}

export function estimateFor(channel: MessagingChannel): number {
  return MESSAGING_ESTIMATE_INR[channel]
}

export function channelCategory(channel: MessagingChannel): WalletCategory {
  return channel
}
