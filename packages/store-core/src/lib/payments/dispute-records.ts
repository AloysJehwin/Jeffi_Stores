import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { createAutoTask, completeAutoTask } from '@/lib/shared/auto-tasks'
import { sendDisputeAdminEmail } from '@/lib/email'

/**
 * payment_disputes: chargebacks the customer's bank raised, in the store whose payment it was.
 * A new or action-required dispute raises a deadline task, a critical alert and an email.
 */

export type DisputeStatus = 'open' | 'under_review' | 'won' | 'lost' | 'closed'
const STATUSES: DisputeStatus[] = ['open', 'under_review', 'won', 'lost', 'closed']
const TERMINAL = new Set<DisputeStatus>(['won', 'lost', 'closed'])

const fromEvent: Record<string, DisputeStatus> = {
  'payment.dispute.created': 'open',
  'payment.dispute.action_required': 'open',
  'payment.dispute.under_review': 'under_review',
  'payment.dispute.won': 'won',
  'payment.dispute.lost': 'lost',
  'payment.dispute.closed': 'closed',
}

export interface DisputeRow {
  id: string
  razorpay_dispute_id: string
  razorpay_payment_id: string
  order_id: string | null
  amount: string
  status: DisputeStatus
  respond_by: string | null
  prev_status: DisputeStatus | null
  prev_event: string | null
}

const at = (unix: unknown) => (Number(unix) > 0 ? new Date(Number(unix) * 1000) : null)

/** Upserts a dispute in the current store. Null when its payment isn't one of this store's (when required). */
export async function upsertDispute(dispute: any, eventType: string | null, opts: { requireLocalPayment?: boolean } = {}): Promise<DisputeRow | null> {
  if (!dispute?.id || !dispute.payment_id) return null
  const local = await queryOne<{ id: string; order_id: string }>(`SELECT id, order_id FROM payments WHERE transaction_id = $1 LIMIT 1`, [dispute.payment_id])
  if (!local && opts.requireLocalPayment) return null
  const status: DisputeStatus = STATUSES.includes(dispute.status) ? dispute.status : (eventType && fromEvent[eventType]) || 'open'
  const row = await queryOne<DisputeRow>(
    `WITH prev AS (SELECT status, last_event FROM payment_disputes WHERE razorpay_dispute_id = $1),
     up AS (
       INSERT INTO payment_disputes (razorpay_dispute_id, razorpay_payment_id, payment_id, order_id, amount, amount_deducted,
                                     reason_code, reason_description, phase, status, respond_by, last_event, raw,
                                     created_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, NOW()),
               CASE WHEN $10 IN ('won','lost','closed') THEN NOW() END)
       ON CONFLICT (razorpay_dispute_id) DO UPDATE SET
         status = CASE WHEN payment_disputes.status IN ('won','lost','closed') AND EXCLUDED.status NOT IN ('won','lost','closed')
                       THEN payment_disputes.status ELSE EXCLUDED.status END,
         closed_at = COALESCE(payment_disputes.closed_at, EXCLUDED.closed_at),
         amount_deducted = GREATEST(payment_disputes.amount_deducted, EXCLUDED.amount_deducted),
         respond_by = COALESCE(EXCLUDED.respond_by, payment_disputes.respond_by),
         phase = COALESCE(EXCLUDED.phase, payment_disputes.phase),
         reason_code = COALESCE(EXCLUDED.reason_code, payment_disputes.reason_code),
         reason_description = COALESCE(EXCLUDED.reason_description, payment_disputes.reason_description),
         last_event = COALESCE(EXCLUDED.last_event, payment_disputes.last_event),
         payment_id = COALESCE(payment_disputes.payment_id, EXCLUDED.payment_id),
         order_id = COALESCE(payment_disputes.order_id, EXCLUDED.order_id),
         raw = EXCLUDED.raw,
         updated_at = NOW()
       RETURNING id, razorpay_dispute_id, razorpay_payment_id, order_id, amount, status, respond_by
     )
     SELECT up.*, (SELECT status FROM prev) AS prev_status, (SELECT last_event FROM prev) AS prev_event FROM up`,
    [
      dispute.id,
      dispute.payment_id,
      local?.id ?? null,
      local?.order_id ?? null,
      (Number(dispute.amount) || 0) / 100,
      (Number(dispute.amount_deducted) || 0) / 100,
      dispute.reason_code ?? null,
      dispute.reason_description ?? null,
      dispute.phase ?? null,
      status,
      at(dispute.respond_by),
      eventType,
      JSON.stringify(dispute),
      at(dispute.created_at),
    ]
  )
  if (row?.order_id) await query(`UPDATE orders SET dispute_status = $1, updated_at = NOW() WHERE id = $2`, [row.status, row.order_id])
  return row
}

/** Once per dispute, and again when Razorpay says it needs action. */
export const isNewDisputeAlert = (row: DisputeRow, eventType: string | null) =>
  row.status === 'open' && (row.prev_status == null || (eventType === 'payment.dispute.action_required' && row.prev_event !== eventType))

/** The admin follow-up for a dispute event: a deadline task, an alert and an email while it's open. */
export async function followUpDispute(row: DisputeRow, eventType: string | null) {
  if (TERMINAL.has(row.status)) {
    await completeAutoTask('respond_dispute', row.id)
    return
  }
  if (!isNewDisputeAlert(row, eventType)) return

  const order = row.order_id
    ? await queryOne<{ order_number: string; user_id: string | null }>(`SELECT order_number, user_id FROM orders WHERE id = $1`, [row.order_id])
    : null
  const respondBy = row.respond_by ? new Date(row.respond_by) : null
  const daysLeft = respondBy ? Math.floor((respondBy.getTime() - Date.now()) / 86400000) : null
  const amount = Number(row.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const label = order ? `#${order.order_number}` : row.razorpay_payment_id
  const due = respondBy ? ` by ${respondBy.toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })}` : ''

  createAdminNotification({
    type: 'payment_dispute',
    category: 'finance',
    title: `Chargeback of Rs. ${amount} on ${label} — respond${due}`,
    message: 'Upload proof of delivery or service on the Razorpay dashboard, or accept the dispute.',
    link: row.order_id ? `/admin/orders/${row.order_id}/view` : '/admin/financial?tab=disputes',
    entityType: 'payment_dispute',
    entityId: row.id,
    severity: 'critical',
    scope: 'financial:read',
  }).catch(() => {})
  if (order?.user_id) {
    createAutoTask({
      userId: order.user_id,
      sourceKind: 'respond_dispute',
      sourceRefId: row.id,
      title: `Respond to the chargeback on #${order.order_number}${due}`,
      description: `The customer's bank disputed Rs. ${amount} (${row.razorpay_dispute_id}). Submit evidence on the Razorpay dashboard before the deadline or the money is lost.`,
      priority: daysLeft != null && daysLeft < 3 ? 'urgent' : 'high',
      dueInDays: daysLeft != null ? Math.max(0, daysLeft - 1) : 0,
    }).catch(() => {})
  }
  sendDisputeAdminEmail({
    disputeId: row.razorpay_dispute_id,
    paymentId: row.razorpay_payment_id,
    amount: Number(row.amount),
    orderId: row.order_id,
    orderNumber: order?.order_number ?? null,
    respondBy,
  }).catch(() => {})
}

/** Backfills this store's disputes from its Razorpay account. Only disputes on its own payments are kept. */
export async function syncDisputes(instance: any): Promise<{ seen: number; saved: number }> {
  let seen = 0
  let saved = 0
  for (let skip = 0; skip < 2000; skip += 100) {
    const page = await instance.disputes.all({ count: 100, skip })
    const items: any[] = Array.isArray(page?.items) ? page.items : []
    for (const d of items) {
      seen++
      const row = await upsertDispute(d, null, { requireLocalPayment: true })
      if (!row) continue
      saved++
      await followUpDispute(row, null)
    }
    if (items.length < 100) break
  }
  return { seen, saved }
}
