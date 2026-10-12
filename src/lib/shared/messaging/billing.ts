import { debitWallet, getWalletBalance, isFlagshipTenant, type WalletCategory } from '@/lib/payments/wallet'
import { estimateFor, channelCategory, type MessagingChannel } from './pricing'

// Messaging uses a ₹0 floor (block only when the balance can't cover the charge), independent of the
// ₹500 shipping floor. Marketing sends are blocked on low balance; transactional (OTP/order/payment)
// are never blocked. A control-plane read failure fails OPEN for transactional, CLOSED for marketing.
const MESSAGING_FLOOR_INR = 0

export interface MessagingGate {
  ok: boolean
  reason?: string
}

export async function checkMessagingBalance(params: {
  tenantId: string | null | undefined
  channel: MessagingChannel
  isMarketing: boolean
}): Promise<MessagingGate> {
  const { tenantId, channel, isMarketing } = params
  if (isFlagshipTenant(tenantId)) return { ok: true }
  const estimate = estimateFor(channel)
  try {
    const { balance } = await getWalletBalance(tenantId as string)
    if (balance - estimate < MESSAGING_FLOOR_INR) {
      return isMarketing
        ? { ok: false, reason: `Insufficient wallet balance to send ${channel}. Recharge to continue.` }
        : { ok: true }
    }
    return { ok: true }
  } catch {
    // Control plane unreadable: don't drop OTP/order (fail open); hold marketing (fail closed).
    return isMarketing ? { ok: false, reason: 'Wallet unavailable.' } : { ok: true }
  }
}

// Debit the EXACT provider price (already converted to INR) for a sent message, idempotent on the
// provider message id. Called from the status-callback webhook. ≤0 price is a no-op.
export async function debitMessageCost(params: {
  tenantId: string
  channel: MessagingChannel
  providerSid: string
  priceInr: number
}): Promise<void> {
  if (!(params.priceInr > 0)) return
  await debitWallet({
    tenantId: params.tenantId,
    amountInr: params.priceInr,
    category: channelCategory(params.channel) as WalletCategory,
    externalRef: `msg:${params.providerSid}`,
    note: `${params.channel} message ${params.providerSid}`,
    floorInr: MESSAGING_FLOOR_INR,
  })
}
