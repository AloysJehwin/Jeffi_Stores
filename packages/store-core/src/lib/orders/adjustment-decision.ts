import 'server-only'
import { query, queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/payments/razorpay'
import { closeReplyContexts } from '@/lib/replies/context'
import { applyAdjustment } from './adjustments'

// The customer's answer to proposed order changes, from the order page or a WhatsApp/email reply.
//   refund      → apply; the refund is issued by an admin from the order page
//   collect     → open a Razorpay order on the tenant's keys; applied by verify/webhook once paid
//   cod_adjust / none → apply now

export type AdjustmentDecision =
  | { ok: true; settlement: 'refund_pending' | 'cod_adjust' | 'none' }
  | { ok: true; settlement: 'collect'; razorpayOrderId: string; amount: number; currency: 'INR'; keyId: string }
  | { ok: false; status: number; error: string }

export async function loadOpenAdjustment(adjId: string, orderId: string) {
  return queryOne<any>(
    `SELECT a.*, o.order_number, o.user_id, o.status AS order_status, o.awb_number, o.original_order_id
       FROM order_adjustments a JOIN orders o ON o.id = a.order_id
      WHERE a.id = $1 AND a.order_id = $2`,
    [adjId, orderId]
  )
}

export async function confirmAdjustment(adjId: string, orderId: string, userId: string | null): Promise<AdjustmentDecision> {
  const adj = await loadOpenAdjustment(adjId, orderId)
  if (!adj) return { ok: false, status: 404, error: 'Change request not found.' }
  if (adj.user_id && adj.user_id !== userId) return { ok: false, status: 403, error: 'This order does not belong to you.' }
  if (adj.status !== 'pending_customer' && adj.status !== 'awaiting_payment') return { ok: false, status: 409, error: 'This change is no longer open.' }
  if (adj.order_status !== 'confirmed' || adj.awb_number) return { ok: false, status: 400, error: 'This order can no longer be changed (it has moved to fulfilment).' }

  const amount = Math.abs(Number(adj.net_diff))
  await closeReplyContexts('orders', orderId, 'order_adjustment')

  // Refund owed: the change applies now; the refund itself waits for an admin to issue it from the
  // order page (every refund is an explicit admin action).
  if (adj.settlement_type === 'refund') {
    const r = await applyAdjustment(adjId)
    if (!r.applied && r.reason !== 'already_applied') return { ok: false, status: 409, error: `Could not apply the change: ${r.reason}` }
    await query(`UPDATE order_adjustments SET refund_status = 'pending', updated_at = NOW() WHERE id = $1 AND refund_status IS NULL`, [adjId])
    return { ok: true, settlement: 'refund_pending' }
  }

  if (adj.settlement_type === 'collect') {
    if (!(await isRazorpayEnabled())) return { ok: false, status: 400, error: 'Payment gateway not configured.' }
    const tenant = await resolveRequestTenant()
    const { instance, creds } = await getRazorpayInstanceFor(tenant?.tenantId)
    let rzpOrderId = adj.razorpay_order_id as string | null
    if (!rzpOrderId) {
      const o = await instance.orders.create({
        amount: Math.round(amount * 100),
        currency: 'INR',
        receipt: `adj-${String(adjId).slice(0, 30)}`,
        notes: { purpose: 'order_adjustment', adjustmentId: adjId, orderId, tenant_id: tenant?.tenantId ?? '', tenant_slug: tenant?.slug ?? '' },
      })
      rzpOrderId = o.id
      await query(`UPDATE order_adjustments SET status = 'awaiting_payment', razorpay_order_id = $1, updated_at = NOW() WHERE id = $2`, [rzpOrderId, adjId])
    }
    return { ok: true, settlement: 'collect', razorpayOrderId: rzpOrderId!, amount: Math.round(amount * 100), currency: 'INR', keyId: creds.key_id }
  }

  const r = await applyAdjustment(adjId)
  if (!r.applied && r.reason !== 'already_applied') return { ok: false, status: 409, error: `Could not apply the change: ${r.reason}` }
  return { ok: true, settlement: adj.settlement_type }
}

/** Nothing has been paid or refunded yet, so declining simply closes it. */
export async function rejectAdjustment(adjId: string, orderId: string, userId: string | null): Promise<boolean> {
  const row = await queryOne(
    `UPDATE order_adjustments a SET status = 'rejected', updated_at = NOW()
       FROM orders o
      WHERE a.id = $1 AND a.order_id = $2 AND o.id = a.order_id AND (o.user_id IS NULL OR o.user_id = $3)
        AND a.status IN ('pending_customer','awaiting_payment') AND a.razorpay_payment_id IS NULL AND a.refunds = '[]'::jsonb
      RETURNING a.id`,
    [adjId, orderId, userId]
  )
  if (row) await closeReplyContexts('orders', orderId, 'order_adjustment')
  return !!row
}
