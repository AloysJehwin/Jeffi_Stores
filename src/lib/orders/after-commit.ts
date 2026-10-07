import 'server-only'
import type { PoolClient } from 'pg'
import { queryOne, queryMany, query } from '@/lib/shared/db'
import { createDraftInvoice } from '@/lib/documents/invoice'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { sendOrderConfirmedSMS } from '@/lib/shared/sms'
import { logActivity } from '@/lib/shared/activity'
import { recordImplicitSignalsForProducts } from '@/lib/shared/ai-feedback'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { attributeConversion } from '@/lib/shared/marketing'
import { grantOrderEntitlements } from '@/lib/orders/entitlements'

/**
 * The single post-commit side-effect union for a paid order. verify, check-pending and the webhook
 * payment.captured recovery each hand-roll a near-identical block; they differ only in which effects
 * they opt into (flags below). Centralised so the P6 subscription cycle commit reuses it. Every
 * effect is fire-and-forget — a failed email never fails a request that already took the money.
 * Grants are NOT fired here (they must run inside the commit txn — see grantDigitalEntitlementsIfAny).
 */

export interface AfterCommitOrder {
  id: string
  order_number: string
  total_amount: string | number
}

export interface AfterCommitUser {
  email: string
  phone?: string | null
  first_name?: string | null
  last_name?: string | null
  notification_channel?: string | null
}

export interface AfterOrderCommittedOpts {
  userId: string
  order: AfterCommitOrder
  /** Omit to load (SELECT * FROM users); when still null the emails + SMS are skipped. */
  user?: AfterCommitUser | null
  /** Omit to load (SELECT * FROM order_items). */
  orderItems?: Array<{ product_id: string | null }> | null

  /** verify only: mark pending_payment_intents committed for this gateway order id. */
  markIntentCommittedForOrderId?: string | null
  /** Pre-bound Route-split thunk (verify/webhook have different fireRouteTransfer signatures). */
  routeTransfer?: (() => Promise<unknown>) | null
  /** webhook recovery only. */
  attributeConversion?: boolean
  /** verify only. */
  sms?: boolean
  /** verify only: review task when total >= 50000. */
  highValueTask?: boolean
  activitySummary?: string
  activityMetadata?: Record<string, unknown>
}

const HIGH_VALUE_THRESHOLD = 50000

function fullName(u: AfterCommitUser): string {
  return `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Customer'
}

export async function afterOrderCommitted(opts: AfterOrderCommittedOpts): Promise<void> {
  const { order, userId } = opts
  const totalInr = Number(order.total_amount)

  if (opts.markIntentCommittedForOrderId) {
    query(`UPDATE pending_payment_intents SET committed = true WHERE razorpay_order_id = $1 AND committed = false`, [
      opts.markIntentCommittedForOrderId,
    ]).catch(() => {})
  }

  if (opts.routeTransfer) {
    opts.routeTransfer()?.catch?.(() => {})
  }

  createDraftInvoice(order.id).catch(() => {})

  const orderItems =
    opts.orderItems ?? ((await queryMany('SELECT * FROM order_items WHERE order_id = $1', [order.id]).catch(() => [])) as Array<{ product_id: string | null }>)

  recordImplicitSignalsForProducts(
    userId,
    (orderItems || []).map(i => i.product_id).filter((id): id is string => !!id),
    'purchased'
  ).catch(() => {})

  logActivity({
    userId,
    kind: 'order_placed',
    referenceId: order.id,
    referenceType: 'orders',
    summary:
      opts.activitySummary ??
      `Placed order #${order.order_number} — ₹${totalInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    metadata: { orderNumber: order.order_number, total: order.total_amount, ...(opts.activityMetadata ?? {}) },
  }).catch(() => {})

  if (opts.attributeConversion) {
    attributeConversion(userId, order.id).catch(() => {})
  }

  if (opts.highValueTask && totalInr >= HIGH_VALUE_THRESHOLD) {
    createAutoTask({
      userId,
      sourceKind: 'review_high_value_order',
      sourceRefId: order.id,
      title: `Review high-value order #${order.order_number} (₹${totalInr.toLocaleString('en-IN')})`,
      description: 'Large order — verify stock, address, and payment before fulfilling.',
      priority: 'high',
      dueInDays: 0,
    }).catch(() => {})
  }

  const user =
    opts.user ?? ((await queryOne<AfterCommitUser>('SELECT * FROM users WHERE id = $1', [userId]).catch(() => null)))
  if (!user) return

  // Reload the full persisted row for the email bodies; the lean `order` arg lacks snapshots.
  const fullOrder = (await queryOne('SELECT * FROM orders WHERE id = $1', [order.id]).catch(() => null)) ?? order

  sendOrderConfirmationEmail(user.email, fullOrder, (orderItems as any[]) || []).catch(() => {})
  sendNewOrderNotification(fullOrder, (orderItems as any[]) || [], user).catch(() => {})
  sendPaymentStatusUpdate(user.email, fullName(user), order.order_number, order.id, 'paid', totalInr).catch(() => {})

  if (opts.sms && user.notification_channel === 'sms' && user.phone) {
    sendOrderConfirmedSMS({ phone: user.phone, orderNumber: order.order_number, total: totalInr }).catch(() => {})
  }
}

/**
 * In-transaction digital grant. No-op for all-physical orders (grantOrderEntitlements self-guards on
 * is_digital = TRUE, which nothing sets until the digital flow lands). MUST use the committing
 * client — a grant must not exist without the committed order.
 */
export async function grantDigitalEntitlementsIfAny(
  client: PoolClient,
  input: { orderId: string; userId: string }
): Promise<number> {
  return grantOrderEntitlements(client, { orderId: input.orderId, userId: input.userId })
}
