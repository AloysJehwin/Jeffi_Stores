import 'server-only'
import crypto from 'crypto'
import { processSubscriptionEvent } from '@/lib/subscriptions/cycle'
import { resolveSubscriptionTenant, runInTenant, type WebhookTenant } from '@/lib/payments/webhook-tenant'
import { TransientWebhookError, type EventContext } from './context'
import { onPaymentCaptured, onPaymentFailed, onPaymentLinkExpired, onPaymentLinkPaid, onQrCodeCredited } from './payments'
import { onRefund } from './refunds'
import { onDisputeLost } from './disputes'
import { onSettlementProcessed, onTransfer } from './settlements'

export { TransientWebhookError, type EventContext, type EventSource } from './context'

const SUBSCRIPTION_EVENTS = [
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.paused',
  'subscription.resumed',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.updated',
]

/** Every webhook event the app handles; platformOnly ones only reach the platform account (Route). */
export const RAZORPAY_WEBHOOK_EVENTS: readonly { event: string; platformOnly?: boolean }[] = [
  { event: 'payment.captured' },
  { event: 'payment.failed' },
  { event: 'payment_link.paid' },
  { event: 'payment_link.expired' },
  { event: 'qr_code.credited' },
  { event: 'refund.created' },
  { event: 'refund.processed' },
  { event: 'refund.failed' },
  { event: 'refund.speed_changed' },
  { event: 'payment.dispute.lost' },
  { event: 'settlement.processed' },
  { event: 'transfer.processed', platformOnly: true },
  { event: 'transfer.failed', platformOnly: true },
  { event: 'transfer.reversed', platformOnly: true },
  ...SUBSCRIPTION_EVENTS.map(event => ({ event })),
]

/** Razorpay's webhook signature, compared in constant time. */
export function verifyRazorpaySignature(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('hex'))
  const given = Buffer.from(signature)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/** Handles one verified event. Throws TransientWebhookError only when a retry could succeed. */
export async function dispatchRazorpayEvent(event: any, ctx: EventContext): Promise<void> {
  const type = String(event?.event ?? '')
  const p = event?.payload ?? {}
  switch (type) {
    case 'payment.captured':
      return onPaymentCaptured(p.payment?.entity, ctx)
    case 'payment.failed':
      return onPaymentFailed(p.payment?.entity, ctx)
    case 'payment_link.paid':
      return onPaymentLinkPaid(p.payment_link?.entity, p.payment?.entity, ctx)
    case 'payment_link.expired':
      return onPaymentLinkExpired(p.payment_link?.entity, ctx)
    case 'qr_code.credited':
      return onQrCodeCredited(p.qr_code?.entity, p.payment?.entity, ctx)
    case 'refund.created':
    case 'refund.processed':
    case 'refund.failed':
    case 'refund.speed_changed':
      return onRefund(type, p.refund?.entity, p.payment?.entity, ctx)
    case 'payment.dispute.lost':
      return onDisputeLost(p.dispute?.entity, p.payment?.entity, ctx)
    case 'settlement.processed':
      return onSettlementProcessed(p.settlement?.entity, ctx)
    case 'transfer.processed':
    case 'transfer.failed':
    case 'transfer.reversed':
      return onTransfer(p.transfer?.entity, ctx)
  }
  if (SUBSCRIPTION_EVENTS.includes(type)) return onSubscriptionEvent(type, event, ctx)
}

/**
 * Customer subscriptions. The platform account finds the store in the control-plane index (notes are
 * only a disagreement check); a store's own account is that store.
 */
async function onSubscriptionEvent(type: string, event: any, ctx: EventContext) {
  const entity = event?.payload?.subscription?.entity
  let store: WebhookTenant | null = ctx.store
  if (ctx.source === 'platform') {
    try {
      store = await resolveSubscriptionTenant(entity)
    } catch (err) {
      throw new TransientWebhookError('subscription tenant resolution failed', err)
    }
  }
  if (!store) {
    console.info('[webhook:subscription] unknown subscription, ack-and-drop', { type, subId: entity?.id })
    return
  }
  const s = store
  await runInTenant(s, async () => {
    try {
      const known = await processSubscriptionEvent(type, event, { tenantId: s.tenantId, slug: s.slug })
      if (!known) console.info('[webhook:subscription] no local row, ack-and-drop', { type, subId: entity?.id, eventId: ctx.eventId })
    } catch (err) {
      throw new TransientWebhookError('subscription in-tenant handler failed', err)
    }
  })
}
