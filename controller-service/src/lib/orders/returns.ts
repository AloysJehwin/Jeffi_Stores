import 'server-only'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { sendReturnStatusEmail } from '@/lib/email'
import { logActivity } from '@/lib/shared/activity'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { checkReturnEligibility } from '@/lib/catalog/return-policy'
import { createAdminNotification } from '@/lib/shared/admin-notify'

// A customer's return/replacement request on a delivered order (storefront route and the support
// assistant). Same checks either way: delivered, items belong to the order, policy window, one open
// request per order, monthly limit.

export const RETURN_REASONS = ['defective', 'wrong_item', 'not_as_described', 'damaged', 'other']

export type ReturnResult = { ok: true; returnRequest: any } | { ok: false; status: number; error: string }

const fail = (status: number, error: string): ReturnResult => ({ ok: false, status, error })

export async function createReturnRequest(
  userId: string,
  orderId: string,
  input: { type: string; reason: string; description?: string | null; image_urls?: string[] | null; items: Array<{ order_item_id: string; quantity?: number | string }> }
): Promise<ReturnResult> {
  const { type, reason, description, image_urls, items } = input

  if (!['refund', 'replacement'].includes(type)) {
    return fail(400, 'Invalid type. Must be refund or replacement.')
  }
  if (!RETURN_REASONS.includes(reason)) {
    return fail(400, 'Invalid reason.')
  }
  if (!Array.isArray(items) || items.length === 0) {
    return fail(400, 'Please select at least one item to return.')
  }

  const order = await queryOne(
    `SELECT o.id, o.status, o.order_number, o.delivered_at, o.updated_at, o.user_id,
            o.customer_name, o.customer_email,
            u.first_name, u.last_name, u.email AS user_email
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId]
  )

  if (!order) return fail(404, 'Order not found')

  if (order.status !== 'delivered') {
    return fail(400, 'Only delivered orders can be returned.')
  }

  // Validate submitted items first so we can scope eligibility check to selected products
  const orderItemIds = items.map((i: any) => i.order_item_id)
  const orderItems = await queryMany(
    `SELECT id, product_id, variant_id, product_name, variant_name, quantity, unit_price, is_digital
     FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[])`,
    [orderId, orderItemIds]
  )

  if (orderItems.length !== orderItemIds.length) {
    return fail(400, 'One or more selected items do not belong to this order.')
  }
  if (orderItems.some((oi: any) => oi.is_digital)) {
    return fail(400, 'Digital items cannot be returned.')
  }

  const selectedProductIds = orderItems.map((oi: any) => String(oi.product_id))

  const eligibility = await checkReturnEligibility(
    orderId,
    type as 'refund' | 'replacement',
    new Date(order.delivered_at || order.updated_at),
    selectedProductIds
  )
  if (!eligibility.ok) {
    return fail(400, eligibility.reason)
  }

  const existing = await queryOne(
    `SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected', 'completed')`,
    [orderId]
  )
  if (existing) {
    return fail(400, 'A return request already exists for this order.')
  }

  const monthlyCount = await queryOne(
    `SELECT COUNT(*) AS cnt
     FROM return_requests rr
     JOIN orders o ON o.id = rr.order_id
     WHERE o.user_id = $1
       AND rr.status NOT IN ('rejected')
       AND DATE_TRUNC('month', rr.created_at) = DATE_TRUNC('month', NOW())`,
    [userId]
  )
  if (parseInt(monthlyCount?.cnt || '0', 10) >= parseInt(process.env.MONTHLY_RETURN_LIMIT || '1', 10)) {
    return fail(400, 'You have already used your return or replacement for this month. Only 1 is allowed per month.')
  }

  // Build validated item rows, cap quantity at ordered quantity
  const itemMap = new Map(orderItems.map((oi: any) => [oi.id, oi]))
  const validatedItems = items.map((i: any) => {
    const oi = itemMap.get(i.order_item_id)
    const qty = Math.min(parseFloat(i.quantity) || parseFloat(oi.quantity), parseFloat(oi.quantity))
    const refundAmount = parseFloat((qty * parseFloat(oi.unit_price)).toFixed(2))
    return { ...oi, returnQty: qty, refundAmount }
  })

  let returnRequest: any
  await withTransaction(async client => {
    const result = await client.query(
      `INSERT INTO return_requests (order_id, user_id, type, reason, description, image_urls)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, userId, type, reason, description || null, image_urls && image_urls.length > 0 ? image_urls : null]
    )
    returnRequest = result.rows[0]

    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO return_request_items
           (return_request_id, order_item_id, product_id, variant_id, quantity, unit_price, refund_amount, product_name, variant_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          returnRequest.id,
          item.id,
          item.product_id,
          item.variant_id || null,
          item.returnQty,
          item.unit_price,
          item.refundAmount,
          item.product_name,
          item.variant_name || null,
        ]
      )
    }

    await client.query(`UPDATE orders SET status = 'return_requested', updated_at = NOW() WHERE id = $1`, [orderId])
  })

  const itemsSummary = validatedItems.map((i: any) => i.product_name).join(', ')

  logActivity({
    userId: userId,
    kind: 'return_requested',
    referenceId: orderId,
    referenceType: 'orders',
    summary: `${type === 'refund' ? 'Refund' : 'Replacement'} requested for order #${order.order_number}: ${reason} (${itemsSummary})`,
    metadata: { type, reason, orderNumber: order.order_number, itemCount: validatedItems.length },
  }).catch(() => {})

  createAutoTask({
    userId: userId,
    sourceKind: 'review_return',
    sourceRefId: orderId,
    title: `Review ${type} request for #${order.order_number}`,
    description: `Reason: ${reason}${description ? `\n\n${description}` : ''}\n\nItems: ${itemsSummary}`,
    priority: 'high',
    dueInDays: 1,
  }).catch(() => {})

  const customerName =
    `${order.first_name || ''} ${order.last_name || ''}`.trim() || order.customer_name || 'Customer'
  const customerEmail = order.user_email || order.customer_email

  const admins = await queryMany(
    `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true AND u.email IS NOT NULL`,
    []
  )
  const adminEmails = admins.map((a: any) => a.email)
  const fallback = process.env.ADMIN_EMAIL
  if (fallback && !adminEmails.includes(fallback)) adminEmails.push(fallback)

  if (adminEmails.length > 0) {
    await sendReturnStatusEmail(adminEmails, customerName, order.order_number, orderId, 'requested_admin', {
      returnType: type,
      reason,
    })
  }

  createAdminNotification({
    type: 'return_requested',
    category: 'returns',
    title: `Return ${type} — #${order.order_number}`,
    message: `${customerName} — ${reason}`,
    link: `/admin/orders/${orderId}`,
    entityType: 'return',
    entityId: String(orderId),
    severity: 'warning',
    scope: 'returns:read',
  }).catch(() => {})

  return { ok: true, returnRequest }
}
