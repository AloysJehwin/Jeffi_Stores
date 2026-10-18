import { processingFeeInr } from '@jeffi/pricing'
import {
  debitWallet,
  debitMessaging,
  getWalletBalance,
  isFlagshipTenant,
  type WalletCategory,
} from '@/lib/payments/wallet'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { createAdminNotification } from '@/lib/shared/admin-notify'
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

// Debit the send-time ESTIMATE for a sent SMS/WhatsApp, idempotent on the provider message id, so
// spend is visible immediately (local dev has no delivery callback). The status callback later trues
// this up to the exact price via debitMessageCost. Resolves the current tenant; flagship exempt.
export async function debitMessageEstimate(params: {
  channel: MessagingChannel
  providerSid: string | null | undefined
}): Promise<void> {
  if (!gateEnabled() || !params.providerSid) return
  const tenantId = await resolveTenantId().catch(() => null)
  if (!tenantId || isFlagshipTenant(tenantId)) return
  await debitMessaging({
    tenantId,
    category: channelCategory(params.channel) as WalletCategory,
    amountInr: estimateFor(params.channel),
    externalRef: `msg:${params.providerSid}`,
    note: `${params.channel} message ${params.providerSid} (estimated)`,
  }).catch(() => {})
}

// True-up to the EXACT provider price (already converted to INR) on the status callback, keyed by the
// provider message id. Adjusts the wallet by the delta vs the send-time estimate (never double-charges).
// Called from the status-callback webhook. ≤0 price is a no-op.
export async function debitMessageCost(params: {
  tenantId: string
  channel: MessagingChannel
  providerSid: string
  priceInr: number
}): Promise<void> {
  if (!(params.priceInr > 0)) return
  await debitMessaging({
    tenantId: params.tenantId,
    category: channelCategory(params.channel) as WalletCategory,
    amountInr: params.priceInr,
    externalRef: `msg:${params.providerSid}`,
    note: `${params.channel} message ${params.providerSid}`,
    trueUp: true,
  })
}

// Terminal Twilio statuses: the message is NOT delivered. Provider price is 0, so the pre-existing
// debitMessageCost branch never refunded the send-time estimate (Gap 2). Refund path keeps only the
// non-refundable processing fee from `@jeffi/pricing` (whatsapp ₹0.20 / sms ₹0.50; internal/platform
// tier = ₹0 → full refund).
const TERMINAL_FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'undelivered'])

// On a terminal failure, true-up the send-time estimate (msg:<sid> ledger row) down to the processing
// fee, so the net wallet charge equals the fee and the rest is credited back. Idempotent on retries
// (keyed by provider sid). No-op for non-terminal status, flagship, or when the gate is off. Returns
// the amounts for the caller to persist on the message row / metrics.
export async function refundMessageEstimate(params: {
  tenantId?: string | null
  sid: string
  channel: MessagingChannel
  status: string
  internal?: boolean
}): Promise<{ refundedInr: number; keptInr: number }> {
  if (!gateEnabled() || !params.sid) return { refundedInr: 0, keptInr: 0 }
  if (!TERMINAL_FAILURE_STATUSES.has(params.status)) return { refundedInr: 0, keptInr: 0 }
  const tenantId = params.tenantId ?? (await resolveTenantId().catch(() => null))
  if (!tenantId || isFlagshipTenant(tenantId)) return { refundedInr: 0, keptInr: 0 }
  const keptInr = processingFeeInr(params.channel, params.internal)
  const estimatedInr = estimateFor(params.channel)
  const refundedInr = Math.max(0, Math.round((estimatedInr - keptInr) * 100) / 100)
  await debitMessaging({
    tenantId,
    category: channelCategory(params.channel) as WalletCategory,
    amountInr: keptInr,
    externalRef: `msg:${params.sid}`,
    note: `${params.channel} message ${params.sid} (${params.status}; refund)`,
    trueUp: true,
  }).catch(() => {})
  return { refundedInr, keptInr }
}

// Message kinds that are marketing (gated on low balance). Transactional kinds (otp, order_*,
// payment_*, support_*, return/refund/variant/access) are never blocked.
const MARKETING_KINDS = new Set([
  'promo_offer',
  'new_arrivals',
  'abandoned_cart',
  'abandoned_checkout',
  'back_in_stock',
  'back_in_stock_wishlist',
  'festive_greeting',
  'reorder_reminder',
  'feedback_request',
  'restock',
  'winback_90',
  'winback_180',
  'price_drop',
  'cart_price_drop',
  'viewed_product',
  'viewed_category',
  'high_value_cart',
  'wishlist_reminder',
  'review_photo_followup',
  'first_purchase_nudge',
  'second_purchase_nudge',
  'signup_anniversary',
  'replenishment',
  'subscription_renewal',
  'loyalty_tier_upgrade',
  'loyalty_points_reminder',
  'referral_invite',
  'birthday',
  'review_request',
  'review_reminder',
  'post_purchase',
])

export function isMarketingKind(kind: string): boolean {
  return MARKETING_KINDS.has(kind)
}

// Email has no delivery callback, so it is charged a fixed estimate synchronously on send success,
// idempotent on the SES message id.
export async function debitEmailCost(messageId: string | null | undefined): Promise<void> {
  if (!gateEnabled() || !messageId) return
  const tenantId = await resolveTenantId().catch(() => null)
  if (!tenantId || isFlagshipTenant(tenantId)) return
  await debitWallet({
    tenantId,
    amountInr: estimateFor('email'),
    category: 'email',
    externalRef: `mail:${messageId}`,
    note: `email ${messageId}`,
    floorInr: MESSAGING_FLOOR_INR,
  }).catch(() => {})
}

// Master kill-switch for dark launch; when off the gate always allows (no metering/blocking).
function gateEnabled(): boolean {
  return process.env.MESSAGING_WALLET_GATE !== 'off'
}

async function notifyLowBalanceOnce(tenantId: string, channel: MessagingChannel): Promise<void> {
  await createAdminNotification({
    type: 'wallet_low_balance',
    category: 'finance',
    severity: 'warning',
    title: 'Low wallet balance',
    message: `A ${channel} message was not sent — the store wallet balance is too low. Recharge to resume marketing sends.`,
    link: '/admin/wallet',
    entityType: 'wallet',
    entityId: tenantId,
  }).catch(() => {})
}

// Pre-send gate used by the send cores. Resolves the current tenant, checks balance, and on a blocked
// marketing send fires a deduped admin notification. Returns true when the send may proceed.
export async function messagingGateAllows(channel: MessagingChannel, isMarketing: boolean): Promise<boolean> {
  if (!gateEnabled()) return true
  const tenantId = await resolveTenantId().catch(() => null)
  const gate = await checkMessagingBalance({ tenantId, channel, isMarketing })
  if (!gate.ok && tenantId) await notifyLowBalanceOnce(tenantId, channel)
  return gate.ok
}
