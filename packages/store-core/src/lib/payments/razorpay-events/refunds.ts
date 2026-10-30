import 'server-only'
import { queryOne, query, withTransaction } from '@/lib/shared/db'
import { applyRouteRefund } from '@/lib/payments/route-settlement'
import { isFlagship, runInTenant } from '@/lib/payments/webhook-tenant'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'
import { applyRefundEvent } from '@/lib/payments/refund-records'
import { storeFor, type EventContext } from './context'

/**
 * A refund was issued, possibly from the Razorpay dashboard, bypassing the app. Then nothing was
 * recorded and no reversal attempted, so the store would keep its share: mark the payment refunded
 * and book the refund against the store's Route ledger. Refunds the app issued already recorded
 * themselves; the status guard makes this a no-op for those.
 */
export async function onRefund(type: string, refund: any, payment: any, ctx: EventContext) {
  const paymentId = (refund?.payment_id ?? '').toString().trim()
  if (!paymentId) return
  const store = await storeFor(ctx, refund, { paymentId, payment })
  if (!store) return

  // Status, ARN and speed for every refund; a failure alerts and undoes the store's Route booking.
  await runInTenant(store, () => applyRefundEvent(type, refund, store)).catch(e => console.error('[webhook:razorpay] refund not recorded', refund?.id, e))
  if (type !== 'refund.created' && type !== 'refund.processed') return

  const order = await runInTenant(store, async () => {
    const current = await queryOne<{ order_id: string; amount: string }>(
      `SELECT order_id, amount FROM payments WHERE transaction_id = $1 AND status <> 'refunded'`,
      [paymentId]
    ).catch(() => null)
    if (!current) return null // already recorded by the in-app refund path

    // A partial refund (an order-change refund, or part of a payment refunded from the dashboard) leaves
    // the payment and order paid; it is only booked against the payment, once per refund id.
    const refundedPaise = Number(payment?.amount_refunded ?? refund?.amount) || 0
    const full = payment?.refund_status ? payment.refund_status === 'full' : refundedPaise >= Math.round(Number(current.amount) * 100) - 1
    if (!full) {
      const refundId = (refund?.id ?? '').toString()
      const entry = { id: refundId, amount: (Number(refund?.amount) || 0) / 100, purpose: refund?.notes?.purpose || 'razorpay_dashboard', at: new Date().toISOString() }
      await query(
        `UPDATE payments
            SET gateway_response = jsonb_set(COALESCE(gateway_response, '{}'::jsonb), '{partial_refunds}',
                  COALESCE(gateway_response->'partial_refunds', '[]'::jsonb) || $2::jsonb),
                updated_at = NOW()
          WHERE transaction_id = $1 AND NOT (COALESCE(gateway_response->'partial_refunds', '[]'::jsonb) @> $3::jsonb)`,
        [paymentId, JSON.stringify([entry]), JSON.stringify([{ id: refundId }])]
      ).catch(() => {})
      return queryOne<{ order_number: string }>(`SELECT order_number FROM orders WHERE id = $1`, [current.order_id]).catch(() => null)
    }

    const updated = await query(
      `UPDATE payments SET status = 'refunded', updated_at = NOW()
        WHERE transaction_id = $1 AND status <> 'refunded'
        RETURNING order_id`,
      [paymentId]
    ).catch(() => null)
    const orderId = updated?.rows?.[0]?.order_id
    if (!orderId) return null

    // A refund covering the whole order total revokes every digital line's vault access. A partial
    // dashboard refund carries no line information, so it revokes nothing.
    const row = await withTransaction(async client => {
      const o = await client.query<{ order_number: string; total_amount: string }>(
        `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1
         RETURNING order_number, total_amount`,
        [orderId]
      )
      const row = o.rows[0]
      if (!row) return null
      const refundPaise = Number(refund?.amount) || 0
      if (refundPaise > 0 && refundPaise >= Math.round(Number(row.total_amount) * 100) - 1) {
        const { revokeOrderEntitlements } = await import('@/lib/orders/entitlements')
        await revokeOrderEntitlements(client, { orderId, reason: 'refund' })
      }
      return row
    }).catch(() =>
      queryOne<{ order_number: string }>(
        `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1 RETURNING order_number`,
        [orderId]
      ).catch(() => null)
    )
    await queueAdsConversion(orderId)
    return row
  })
  if (!order?.order_number || isFlagship(store)) return

  // Idempotent on the refund id: an app refund already called this; a dashboard refund is booked here,
  // reversing the store's share and recording any shortfall as debt for retry-reversals.
  await applyRouteRefund({
    tenantId: store.tenantId,
    paymentId,
    refundId: (refund?.id ?? '').toString(),
    refundPaise: Number(refund?.amount) || 0,
    orderRef: order.order_number,
  }).catch(() => {})
}
