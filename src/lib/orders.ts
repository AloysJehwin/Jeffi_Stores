import { queryOne, queryMany, query } from './db'
import { sendOrderAutoCancelledEmail, sendOrderAutoCancelledAdminNotification, sendOrderStatusUpdate } from './email'
import { createAutoTask } from './auto-tasks'
import { logActivity } from './activity'

export const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']

export type CancelReason = 'user_request' | 'auto_cancel_unpaid'

export type CancelResult =
  | { success: true; directCancel: boolean; restoredToCart: boolean; cancelRequested?: boolean }
  | { success: false; error: string; status: number }

interface CancelOptions {
  reason: CancelReason
  restoreToCart?: boolean
  expectedUserId?: string
}

export async function cancelOrder(orderId: string, opts: CancelOptions): Promise<CancelResult> {
  const order = await queryOne<any>(`
    SELECT o.id, o.order_number, o.status, o.payment_status, o.user_id, o.order_type,
      o.customer_name, o.customer_email, o.total_amount,
      json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = $1
  `, [orderId])

  if (!order) {
    return { success: false, error: 'Order not found', status: 404 }
  }

  if (opts.expectedUserId && order.user_id !== opts.expectedUserId) {
    return { success: false, error: 'Order not found', status: 404 }
  }

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return {
      success: false,
      error: `Cancellation cannot be requested — current status is "${order.status}"`,
      status: 400,
    }
  }

  const isUnpaidPending =
    order.status === 'pending' &&
    (order.payment_status === 'unpaid' || order.payment_status === 'failed')

  if (isUnpaidPending) {
    const restoreToCart = opts.restoreToCart === true && order.order_type !== 'direct'

    const orderItems = await queryMany<any>(
      'SELECT product_id, variant_id, quantity, unit_price FROM order_items WHERE order_id = $1',
      [orderId]
    )

    if (restoreToCart) {
      for (const item of orderItems) {
        const existingCartItem = await queryOne<any>(
          'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3',
          [order.user_id, item.product_id, item.variant_id || null]
        )
        if (existingCartItem) {
          await query(
            'UPDATE cart_items SET quantity = cart_items.quantity + $1, updated_at = NOW() WHERE id = $2',
            [item.quantity, existingCartItem.id]
          )
        } else {
          await query(
            'INSERT INTO cart_items (user_id, product_id, variant_id, quantity, price_at_addition) VALUES ($1, $2, $3, $4, $5)',
            [order.user_id, item.product_id, item.variant_id || null, item.quantity, item.unit_price]
          )
        }
      }
    }

    await query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId]
    )

    if (opts.reason === 'auto_cancel_unpaid') {
      const user = order.users
      const userEmail = user?.email || order.customer_email
      const userName = (user
        ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
        : order.customer_name) || 'Customer'

      let redirectPath = '/products'
      if (order.order_type === 'direct') {
        const firstItem = await queryOne<{ slug: string | null }>(
          `SELECT p.slug FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1 LIMIT 1`,
          [orderId]
        )
        redirectPath = firstItem?.slug ? `/products/${firstItem.slug}` : '/products'
      } else {
        redirectPath = '/cart'
      }

      if (userEmail) {
        sendOrderAutoCancelledEmail(
          userEmail,
          userName,
          order.order_number,
          orderId,
          order.order_type || 'cart',
          parseFloat(order.total_amount),
          redirectPath
        ).catch(() => {})
      }

      sendOrderAutoCancelledAdminNotification(order, redirectPath).catch(() => {})

      if (order.user_id) {
        createAutoTask({
          userId: order.user_id,
          sourceKind: 'abandoned_checkout',
          sourceRefId: orderId,
          title: `Reach out about abandoned checkout #${order.order_number}`,
          description: `Order auto-cancelled (10-min payment window). Total ₹${order.total_amount}. Worth a follow-up.`,
          priority: 'medium',
          dueInDays: 1,
        }).catch(() => {})
      }
    }

    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        kind: 'order_status',
        referenceId: orderId,
        referenceType: 'orders',
        summary: opts.reason === 'auto_cancel_unpaid'
          ? `Order #${order.order_number} auto-cancelled (payment timeout)`
          : `Cancelled order #${order.order_number}`,
        metadata: { order_status: 'cancelled', reason: opts.reason },
      }).catch(() => {})
    }

    return { success: true, directCancel: true, restoredToCart: restoreToCart }
  }

  await query(
    `UPDATE orders SET status = 'cancel_requested', updated_at = NOW() WHERE id = $1`,
    [orderId]
  )

  if (order.user_id) {
    logActivity({
      userId: order.user_id,
      kind: 'order_status',
      referenceId: orderId,
      referenceType: 'orders',
      summary: `Requested cancellation for #${order.order_number}`,
      metadata: { order_status: 'cancel_requested' },
    }).catch(() => {})
  }

  const user = order.users
  const userEmail = user?.email || order.customer_email
  const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

  if (userEmail && userName) {
    sendOrderStatusUpdate(
      userEmail,
      userName,
      order.order_number,
      orderId,
      'cancel_requested',
      order.status
    ).catch(() => {})
  }

  return { success: true, directCancel: false, restoredToCart: false, cancelRequested: true }
}
