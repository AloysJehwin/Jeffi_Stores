import 'server-only'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { recordExternalRefund } from '@/lib/payments/refund'
import { isFlagship, runInTenant } from '@/lib/payments/webhook-tenant'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'
import { followUpDispute, isNewDisputeAlert, upsertDispute } from '@/lib/payments/dispute-records'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { storeFor, type EventContext } from './context'

/** Every payment.dispute.* event: recorded in the payment's store, which gets the deadline task and alert. */
export async function onDispute(type: string, dispute: any, payment: any, ctx: EventContext) {
  const paymentId = (dispute?.payment_id ?? payment?.id ?? '').toString().trim()
  if (!dispute?.id || !paymentId) return
  const store = await storeFor(ctx, payment ?? dispute, { paymentId })
  if (!store) return
  const entity = { ...dispute, payment_id: paymentId }
  const row = await runInTenant(store, async () => {
    const r = await upsertDispute(entity, type)
    if (r) await followUpDispute(r, type)
    return r
  })
  // A Route store's chargeback still comes out of the platform account: the flagship hears of it too.
  if (row && ctx.source === 'platform' && !isFlagship(store) && isNewDisputeAlert(row, type)) {
    createAdminNotification({
      type: 'payment_dispute',
      category: 'finance',
      title: `Chargeback of Rs. ${Number(row.amount).toFixed(2)} on ${store.slug || 'a store'}'s payment ${row.razorpay_payment_id}`,
      message: `Dispute ${row.razorpay_dispute_id}. The store has been asked to respond; a lost dispute is recovered from its share.`,
      link: `https://dashboard.razorpay.com/app/disputes/${row.razorpay_dispute_id}`,
      entityType: 'payment_dispute',
      entityId: row.razorpay_dispute_id,
      severity: 'critical',
      scope: 'financial:read',
    }).catch(() => {})
  }
  if (type === 'payment.dispute.lost') await onDisputeLost(entity, payment, ctx)
}

/**
 * A lost dispute (chargeback) returns the money through the customer's bank, not as a refund. Record it
 * as one so the order, the payment and the store's Route share settle the same way. Keyed on the
 * dispute id, so a redelivered event changes nothing.
 */
async function onDisputeLost(dispute: any, payment: any, ctx: EventContext) {
  const paymentId = (dispute?.payment_id ?? payment?.id ?? '').toString().trim()
  const disputeId = (dispute?.id ?? '').toString().trim()
  const paise = Number(dispute?.amount_deducted) || Number(dispute?.amount) || 0
  if (!paymentId || !disputeId || !(paise > 0)) return
  const store = await storeFor(ctx, payment ?? dispute, { paymentId })
  if (!store) return

  await runInTenant(store, async () => {
    const row = await queryOne<{ order_id: string; amount: string; order_number: string; total_amount: string }>(
      `SELECT p.order_id, p.amount, o.order_number, o.total_amount
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.transaction_id = $1 AND p.status = 'completed' AND COALESCE(p.gateway_response::text, '') NOT LIKE '%' || $2 || '%'`,
      [paymentId, disputeId]
    )
    if (!row) return
    const full = paise >= Math.round(Number(row.amount) * 100) - 1
    await recordExternalRefund({
      orderId: row.order_id,
      amount: paise / 100,
      full,
      refund: { method: 'razorpay_dispute', reference: disputeId, note: dispute?.reason_code ? `Dispute lost (${dispute.reason_code})` : 'Dispute lost' },
      purpose: 'dispute',
      orderRef: row.order_number,
      tenantId: isFlagship(store) ? undefined : store.tenantId,
      transactionId: paymentId,
    })
    if (!full) return
    await withTransaction(async client => {
      await client.query(`UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`, [row.order_id])
      if (paise >= Math.round(Number(row.total_amount) * 100) - 1) {
        const { revokeOrderEntitlements } = await import('@/lib/orders/entitlements')
        await revokeOrderEntitlements(client, { orderId: row.order_id, reason: 'refund' })
      }
    })
    await queueAdsConversion(row.order_id)
  }).catch(e => console.error('[webhook:razorpay] dispute.lost not recorded', paymentId, e))
}
