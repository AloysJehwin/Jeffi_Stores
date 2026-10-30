import 'server-only'
import {
  flagshipScope,
  runInTenant,
  scopeForEntity,
  storeForRazorpayOrder,
  type WebhookTenant,
} from '@/lib/payments/webhook-tenant'

/** 'platform': the platform account's webhook. 'own': a store's own Razorpay account. */
export type EventSource = 'platform' | 'own'

export interface EventContext {
  source: EventSource
  /** The store whose own account sent the event; null on the platform account. */
  store: WebhookTenant | null
  eventId: string | null
  accountId: string | null
}

/** Raised on a failure worth a retry (a 503), never for an event we simply don't know. */
export class TransientWebhookError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'TransientWebhookError'
  }
}

const str = (v: unknown) => (v ?? '').toString().trim()

/**
 * The store an event's writes go to; null drops it. A store's own account only speaks for that store,
 * so an entity whose notes name another store is ignored.
 */
export async function storeFor(ctx: EventContext, entity: any, opts: { paymentId?: string; payment?: any } = {}) {
  if (ctx.source === 'own') {
    const named = [entity?.notes?.tenant_id, opts.payment?.notes?.tenant_id].map(str).find(Boolean)
    return named && ctx.store && named !== ctx.store.tenantId ? null : ctx.store
  }
  try {
    return await scopeForEntity(entity, opts)
  } catch (e) {
    throw new TransientWebhookError('store lookup failed', e)
  }
}

/**
 * Runs fn in the payment's store. On the platform account, when nothing there was waiting for the
 * payment, it tries once more in the store the Razorpay order was made for: a customer can set payment
 * notes at checkout, but the order's notes are ours.
 */
export async function inPaymentStore(
  ctx: EventContext,
  payment: any,
  fn: (store: WebhookTenant) => Promise<string>
): Promise<void> {
  const first = await storeFor(ctx, payment)
  if (first && (await runInTenant(first, () => fn(first))) !== 'unmatched') return
  if (ctx.source === 'own') return
  let byOrder: WebhookTenant | null | undefined
  try {
    byOrder = await storeForRazorpayOrder(payment?.order_id)
  } catch (e) {
    throw new TransientWebhookError('store lookup failed', e)
  }
  const second = byOrder === undefined ? flagshipScope() : byOrder
  if (second && second.tenantId !== first?.tenantId) await runInTenant(second, () => fn(second))
}
