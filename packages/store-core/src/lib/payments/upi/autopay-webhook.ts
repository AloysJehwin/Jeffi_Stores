import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { advanceRedemption, syncAutopaySetup, syncAutopaySubscription, type Store } from '@/lib/subscriptions/autopay'

/**
 * PhonePe Autopay webhook events (docs/PAYMENTS_UPI.md, "PhonePe Autopay"). The dispatcher has already
 * checked the Authorization header and is inside the store's DB context. As with checkout events the
 * body's state is never trusted: every event re-reads the order / mandate from PhonePe.
 */

export interface AutopayWebhookCtx {
  /** The store whose PhonePe account sent the event; null / the nil id = the flagship. */
  store?: { tenantId: string; slug?: string } | null
}

const NIL = '00000000-0000-0000-0000-000000000000'
const str = (v: unknown) => (v ?? '').toString().trim()

/** True for the event names only Autopay sends (setup orders arrive as checkout.order.* and are matched by id). */
export const isAutopayEvent = (type: string) => type.startsWith('subscription.')

export async function handleAutopayWebhook(event: any, ctx: AutopayWebhookCtx = {}): Promise<{ handled: boolean }> {
  const type = str(event?.event ?? event?.type).toLowerCase()
  const payload = event?.payload ?? {}
  const store: Store = ctx.store?.tenantId && ctx.store.tenantId !== NIL ? { tenantId: ctx.store.tenantId, slug: ctx.store.slug ?? '' } : null
  const moid = str(payload.merchantOrderId)
  const msid = str(payload.merchantSubscriptionId ?? payload.paymentFlow?.merchantSubscriptionId)

  // Mandate setup: a checkout order whose id is a subscription's setup order.
  if (type.startsWith('checkout.')) {
    if (!moid) return { handled: false }
    const sub = await queryOne<{ id: string }>(`SELECT id FROM subscriptions WHERE phonepe_setup_order_id = $1 AND billing_provider = 'phonepe'`, [moid])
    if (!sub) return { handled: false }
    await syncAutopaySetup(sub.id, { store })
    return { handled: true }
  }
  if (!isAutopayEvent(type)) return { handled: false }

  // Pre-debit notification and the debit itself.
  if (type.startsWith('subscription.notification.') || type.startsWith('subscription.redemption.')) {
    if (!moid) return { handled: false }
    const r = await queryOne<{ id: string }>(`SELECT id FROM subscription_redemptions WHERE merchant_order_id = $1`, [moid])
    if (!r) return { handled: false }
    await advanceRedemption(r.id, store)
    return { handled: true }
  }

  // Paused / unpaused / revoked / cancelled, by the customer in their UPI app or by us.
  if (!msid) return { handled: false }
  const sub = await queryOne<{ id: string }>(`SELECT id FROM subscriptions WHERE phonepe_merchant_subscription_id = $1 AND billing_provider = 'phonepe'`, [msid])
  if (!sub) return { handled: false }
  await syncAutopaySubscription(sub.id, store)
  return { handled: true }
}
