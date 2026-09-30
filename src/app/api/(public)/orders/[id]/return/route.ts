import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { query, queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { sendReturnStatusEmail } from '@/lib/email'
import { logActivity } from '@/lib/shared/activity'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { checkReturnEligibility } from '@/lib/catalog/return-policy'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { getBusinessValues } from '@/lib/catalog/site-controls'

const REASONS = ['defective', 'wrong_item', 'not_as_described', 'damaged', 'other']

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const returnRequest = await queryOne(
      `SELECT * FROM return_requests WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [id, authUser.userId]
    )

    let returnItems = null
    if (returnRequest) {
      returnItems = await queryMany(
        `SELECT * FROM return_request_items WHERE return_request_id = $1 ORDER BY created_at`,
        [returnRequest.id]
      )
    }

    const monthlyCount = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE o.user_id = $1
         AND rr.status NOT IN ('rejected')
         AND DATE_TRUNC('month', rr.created_at) = DATE_TRUNC('month', NOW())`,
      [authUser.userId]
    )
    const monthlyLimitReached =
      parseInt(monthlyCount?.cnt || '0', 10) >= parseInt(process.env.MONTHLY_RETURN_LIMIT || '1', 10)

    // Refund breakdown so the customer sees the actual amount and, when the return charge covers
    // it, an explanation instead of a bare "refund processed".
    let refundBreakdown: { grossRefund: number; charge: number; netRefund: number } | null = null
    if (returnRequest?.type === 'refund' && Array.isArray(returnItems) && returnItems.length > 0) {
      const grossRefund = returnItems.reduce((s: number, i: any) => s + (parseFloat(i.refund_amount) || 0), 0)
      const returnStandardCharge = (await getBusinessValues().catch(() => null))?.returnStandardCharge ?? 0
      const charge = Math.min(returnStandardCharge, grossRefund)
      const netRefund = Math.max(0, Math.round((grossRefund - returnStandardCharge) * 100) / 100)
      refundBreakdown = { grossRefund, charge, netRefund }
    }

    return NextResponse.json({
      returnRequest: returnRequest || null,
      returnItems: returnItems || [],
      monthlyLimitReached,
      refundBreakdown,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { type, reason, description, image_urls, items } = await request.json()

    if (!['refund', 'replacement'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be refund or replacement.' }, { status: 400 })
    }
    if (!REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason.' }, { status: 400 })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Please select at least one item to return.' }, { status: 400 })
    }

    const order = await queryOne(
      `SELECT o.id, o.status, o.order_number, o.delivered_at, o.updated_at, o.user_id,
              o.customer_name, o.customer_email,
              u.first_name, u.last_name, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [id, authUser.userId]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (order.status !== 'delivered') {
      return NextResponse.json({ error: 'Only delivered orders can be returned.' }, { status: 400 })
    }

    // Validate submitted items first so we can scope eligibility check to selected products
    const orderItemIds = items.map((i: any) => i.order_item_id)
    const orderItems = await queryMany(
      `SELECT id, product_id, variant_id, product_name, variant_name, quantity, unit_price
       FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[])`,
      [id, orderItemIds]
    )

    if (orderItems.length !== orderItemIds.length) {
      return NextResponse.json({ error: 'One or more selected items do not belong to this order.' }, { status: 400 })
    }

    const selectedProductIds = orderItems.map((oi: any) => String(oi.product_id))

    const eligibility = await checkReturnEligibility(
      id,
      type as 'refund' | 'replacement',
      new Date(order.delivered_at || order.updated_at),
      selectedProductIds
    )
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.reason }, { status: 400 })
    }

    const existing = await queryOne(
      `SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected', 'completed')`,
      [id]
    )
    if (existing) {
      return NextResponse.json({ error: 'A return request already exists for this order.' }, { status: 400 })
    }

    const monthlyCount = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE o.user_id = $1
         AND rr.status NOT IN ('rejected')
         AND DATE_TRUNC('month', rr.created_at) = DATE_TRUNC('month', NOW())`,
      [authUser.userId]
    )
    if (parseInt(monthlyCount?.cnt || '0', 10) >= parseInt(process.env.MONTHLY_RETURN_LIMIT || '1', 10)) {
      return NextResponse.json(
        {
          error: 'You have already used your return or replacement for this month. Only 1 is allowed per month.',
        },
        { status: 400 }
      )
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
        [id, authUser.userId, type, reason, description || null, image_urls?.length > 0 ? image_urls : null]
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

      await client.query(`UPDATE orders SET status = 'return_requested', updated_at = NOW() WHERE id = $1`, [id])
    })

    const itemsSummary = validatedItems.map((i: any) => i.product_name).join(', ')

    logActivity({
      userId: authUser.userId,
      kind: 'return_requested',
      referenceId: id,
      referenceType: 'orders',
      summary: `${type === 'refund' ? 'Refund' : 'Replacement'} requested for order #${order.order_number}: ${reason} (${itemsSummary})`,
      metadata: { type, reason, orderNumber: order.order_number, itemCount: validatedItems.length },
    }).catch(() => {})

    createAutoTask({
      userId: authUser.userId,
      sourceKind: 'review_return',
      sourceRefId: id,
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
      await sendReturnStatusEmail(adminEmails, customerName, order.order_number, id, 'requested_admin', {
        returnType: type,
        reason,
      })
    }

    createAdminNotification({
      type: 'return_requested',
      category: 'returns',
      title: `Return ${type} — #${order.order_number}`,
      message: `${customerName} — ${reason}`,
      link: `/admin/orders/${id}`,
      entityType: 'return',
      entityId: String(id),
      severity: 'warning',
      scope: 'returns:read',
    }).catch(() => {})

    return NextResponse.json({ returnRequest }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create return request' }, { status: 500 })
  }
}
