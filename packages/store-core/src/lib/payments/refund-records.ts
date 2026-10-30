import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { applyRouteRefundFailed } from '@/lib/payments/route-settlement'
import { isFlagship } from '@/lib/payments/webhook-tenant'

/**
 * payment_refunds: one row per Razorpay refund, made in the app or on the dashboard. Status only moves
 * forward (pending → processed | failed). A failed refund raises an alert and a task to retry it.
 */

type InitiatedBy = 'app' | 'dashboard' | 'dispute' | 'retry'

const inr = (paise: unknown) => (Number(paise) || 0) / 100
// The bank's reference the customer can quote: ARN for cards, RRN for UPI, UTR for net banking.
const arnOf = (r: any) => r?.acquirer_data?.arn || r?.acquirer_data?.rrn || r?.acquirer_data?.utr || null
const statusOf = (r: any) => (['pending', 'processed', 'failed'].includes(r?.status) ? r.status : 'pending')

/** Records a refund the app just asked Razorpay for. Idempotent on the refund id. */
export async function recordRefund(opts: {
  refund: any
  paymentRowId?: string | null
  orderId?: string | null
  purpose?: string | null
  initiatedBy?: InitiatedBy
  retryOf?: string | null
}) {
  const r = opts.refund
  if (!r?.id) return
  await query(
    `INSERT INTO payment_refunds (razorpay_refund_id, razorpay_payment_id, payment_id, order_id, amount, status,
                                  speed_requested, speed_processed, arn, acquirer_data, purpose, initiated_by, retry_of, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $6 = 'processed' THEN NOW() END)
     ON CONFLICT (razorpay_refund_id) DO NOTHING`,
    [
      r.id,
      r.payment_id,
      opts.paymentRowId ?? null,
      opts.orderId ?? null,
      inr(r.amount),
      statusOf(r),
      r.speed_requested ?? null,
      r.speed_processed ?? null,
      arnOf(r),
      r.acquirer_data ? JSON.stringify(r.acquirer_data) : null,
      opts.purpose ?? r.notes?.purpose ?? null,
      opts.initiatedBy ?? 'app',
      opts.retryOf ?? null,
    ]
  )
}

interface RefundRow {
  id: string
  order_id: string | null
  status: string
  amount: string
  prev_status: string | null
}

/**
 * A refund event (created, processed, failed, speed_changed) in the payment's store. A refund the app
 * didn't record came from the Razorpay dashboard. Returns the row, or null when it can't be placed.
 */
export async function applyRefundEvent(type: string, refund: any, store: { tenantId: string; slug?: string | null } | null) {
  if (!refund?.id || !refund.payment_id) return null
  const local = await queryOne<{ id: string; order_id: string }>(`SELECT id, order_id FROM payments WHERE transaction_id = $1 LIMIT 1`, [
    refund.payment_id,
  ])
  const status = type === 'refund.failed' ? 'failed' : type === 'refund.processed' ? 'processed' : statusOf(refund)
  const row = await queryOne<RefundRow>(
    `WITH prev AS (SELECT status FROM payment_refunds WHERE razorpay_refund_id = $1),
     up AS (
       INSERT INTO payment_refunds (razorpay_refund_id, razorpay_payment_id, payment_id, order_id, amount, status,
                                    speed_requested, speed_processed, arn, acquirer_data, purpose, initiated_by,
                                    failure_reason, processed_at, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               CASE WHEN $6 = 'processed' THEN NOW() END, CASE WHEN $6 = 'failed' THEN NOW() END)
       ON CONFLICT (razorpay_refund_id) DO UPDATE SET
         status = CASE WHEN payment_refunds.status = 'pending' THEN EXCLUDED.status ELSE payment_refunds.status END,
         processed_at = CASE WHEN payment_refunds.status = 'pending' AND EXCLUDED.status = 'processed' THEN NOW() ELSE payment_refunds.processed_at END,
         failed_at = CASE WHEN payment_refunds.status = 'pending' AND EXCLUDED.status = 'failed' THEN NOW() ELSE payment_refunds.failed_at END,
         speed_processed = COALESCE(EXCLUDED.speed_processed, payment_refunds.speed_processed),
         arn = COALESCE(EXCLUDED.arn, payment_refunds.arn),
         acquirer_data = COALESCE(EXCLUDED.acquirer_data, payment_refunds.acquirer_data),
         failure_reason = COALESCE(EXCLUDED.failure_reason, payment_refunds.failure_reason),
         payment_id = COALESCE(payment_refunds.payment_id, EXCLUDED.payment_id),
         order_id = COALESCE(payment_refunds.order_id, EXCLUDED.order_id),
         updated_at = NOW()
       RETURNING id, order_id, status, amount
     )
     SELECT up.id, up.order_id, up.status, up.amount, (SELECT status FROM prev) AS prev_status FROM up`,
    [
      refund.id,
      refund.payment_id,
      local?.id ?? null,
      local?.order_id ?? null,
      inr(refund.amount),
      status,
      refund.speed_requested ?? null,
      refund.speed_processed ?? null,
      arnOf(refund),
      refund.acquirer_data ? JSON.stringify(refund.acquirer_data) : null,
      refund.notes?.purpose ?? null,
      refund.notes?.purpose === 'dispute' ? 'dispute' : 'dashboard',
      status === 'failed' ? refund.error?.description || refund.notes?.failure_reason || null : null,
    ]
  )
  if (row?.id && row.status === 'failed' && row.prev_status !== 'failed') await onRefundFailed(row, refund, store)
  return row
}

async function onRefundFailed(row: RefundRow, refund: any, store: { tenantId: string; slug?: string | null } | null) {
  const order = row.order_id
    ? await queryOne<{ order_number: string; user_id: string | null }>(`SELECT order_number, user_id FROM orders WHERE id = $1`, [row.order_id])
    : null
  const label = order ? `#${order.order_number}` : refund.payment_id
  const amount = Number(row.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })
  createAdminNotification({
    type: 'refund_failed',
    category: 'finance',
    title: `Refund of Rs. ${amount} failed on ${label}`,
    message: 'The money is back in the Razorpay balance. Retry the refund from the order, or pay the customer another way.',
    link: row.order_id ? `/admin/orders/${row.order_id}/view` : null,
    entityType: 'payment_refund',
    entityId: row.id,
    severity: 'critical',
    scope: 'orders:read',
  }).catch(() => {})
  if (order?.user_id) {
    createAutoTask({
      userId: order.user_id,
      sourceKind: 'retry_failed_refund',
      sourceRefId: row.id,
      title: `Retry the failed refund on #${order.order_number}`,
      description: `Razorpay could not refund Rs. ${amount} (${refund.id}).`,
      priority: 'urgent',
      dueInDays: 0,
    }).catch(() => {})
  }
  if (store && !isFlagship(store)) {
    await applyRouteRefundFailed({
      tenantId: store.tenantId,
      paymentId: refund.payment_id,
      refundId: refund.id,
      refundPaise: Number(refund.amount) || 0,
      orderRef: order?.order_number ?? null,
    }).catch(() => {})
  }
}
