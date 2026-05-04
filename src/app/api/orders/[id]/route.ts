import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser, authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'
import { cancelDelhiveryShipment } from '@/lib/delhivery'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id

    const order = await queryOne(`
      SELECT o.*,
        (SELECT row_to_json(a) FROM (
          SELECT full_name, address_line1, address_line2, landmark, city, state, postal_code, phone
          FROM addresses WHERE id = o.shipping_address_id
        ) a) AS shipping_address,
        orig.order_number AS original_order_number
      FROM orders o
      LEFT JOIN orders orig ON orig.id = o.original_order_id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const orderItems = await queryMany(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.variant_name, oi.quantity, oi.unit_price, oi.total_price, oi.buy_mode, oi.buy_unit,
        json_build_object('slug', p.slug, 'product_images',
          COALESCE(
            (SELECT json_agg(pi ORDER BY pi.display_order)
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId])

    const orderDetails = {
      id: order.id,
      orderNumber: order.order_number,
      invoiceNumber: order.invoice_number || null,
      totalAmount: parseFloat(order.total_amount),
      subtotal: parseFloat(order.subtotal || order.total_amount),
      taxAmount: parseFloat(order.tax_amount || '0'),
      discountAmount: parseFloat(order.discount_amount || '0'),
      shippingAmount: parseFloat(order.shipping_amount || '0'),
      status: order.status,
      paymentStatus: order.payment_status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      deliveredAt: order.delivered_at || null,
      notes: order.notes,
      trackingUrl: order.tracking_url || null,
      awbNumber: order.awb_number || null,
      originalOrderId: order.original_order_id || null,
      originalOrderNumber: order.original_order_number || null,
      shippingAddress: order.shipping_address,
      items: orderItems.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        variantName: item.variant_name || null,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unit_price),
        totalPrice: parseFloat(item.total_price),
        buyMode: item.buy_mode || 'unit',
        buyUnit: item.buy_unit || null,
        products: item.products,
      })),
    }

    return NextResponse.json({ order: orderDetails })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id
    const body = await request.json()
    const { status, payment_status, tracking_url } = body

    const currentOrder = await queryOne(`
      SELECT
        o.order_number, o.status, o.payment_status, o.total_amount,
        o.user_id, o.customer_name, o.customer_email,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [orderId])

    if (!currentOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending:          ['confirmed', 'cancel_requested', 'cancelled'],
      confirmed:        ['processing', 'cancel_requested', 'cancelled'],
      processing:       ['shipped', 'cancel_requested'],
      shipped:          ['delivered'],
      delivered:        ['return_requested'],
      cancel_requested: ['cancelled', 'cancel_rejected'],
      cancel_rejected:  [],
      cancelled:        [],
      return_requested: ['return_approved', 'return_rejected'],
      return_approved:  ['return_received'],
      return_received:  ['returned'],
      return_rejected:  [],
      returned:         [],
    }

    const TERMINAL_STATUSES = ['cancelled', 'cancel_rejected', 'return_rejected', 'returned']

    if (TERMINAL_STATUSES.includes(currentOrder.status)) {
      return NextResponse.json({ error: `Orders with status '${currentOrder.status}' cannot be modified` }, { status: 400 })
    }

    const validPaymentStatuses = ['pending', 'paid', 'failed', 'refunded']

    if (status && status !== currentOrder.status) {
      const allowed = VALID_TRANSITIONS[currentOrder.status] ?? []
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `Cannot transition order from '${currentOrder.status}' to '${status}'` },
          { status: 400 }
        )
      }
    }

    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
      return NextResponse.json({ error: `Invalid payment status: ${payment_status}` }, { status: 400 })
    }

    if (currentOrder.payment_status === 'paid' && payment_status === 'pending') {
      return NextResponse.json({ error: 'Paid orders cannot revert to pending. Use refunded instead.' }, { status: 400 })
    }

    const statusChanged = status && status !== currentOrder.status
    const paymentStatusChanged = payment_status && payment_status !== currentOrder.payment_status

    const updates: string[] = ['updated_at = NOW()']
    const values: any[] = []
    let paramIndex = 1

    if (status) {
      updates.push(`status = $${paramIndex}`)
      values.push(status)
      paramIndex++
    }

    if (payment_status) {
      updates.push(`payment_status = $${paramIndex}`)
      values.push(payment_status)
      paramIndex++
    }

    if (status === 'shipped' && tracking_url?.trim()) {
      updates.push(`tracking_url = $${paramIndex}`)
      values.push(tracking_url.trim())
      paramIndex++
    }

    if (status === 'delivered') {
      updates.push(`delivered_at = NOW()`)
    }

    values.push(orderId)

    await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    )

    const response = NextResponse.json({ success: true })

    const notify = async () => {
      let invoicePdfBuffer: Buffer | null = null
      const effectivePaymentStatus = payment_status || currentOrder.payment_status
      if (statusChanged && (status === 'confirmed' || status === 'processing') && effectivePaymentStatus === 'paid') {
        try { invoicePdfBuffer = await generateOrderInvoice(orderId) } catch {}
      }

      const effectiveStatus = status || currentOrder.status
      if (paymentStatusChanged && payment_status === 'paid' && (effectiveStatus === 'confirmed' || effectiveStatus === 'processing')) {
        if (!invoicePdfBuffer) {
          try { invoicePdfBuffer = await generateOrderInvoice(orderId) } catch {}
        }
      }

      const user = currentOrder.users
      const userEmail = user?.email || currentOrder.customer_email
      const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : currentOrder.customer_name

      if (statusChanged && status === 'cancelled') {
        const orderWithAwb = await queryOne<{ awb_number: string | null }>('SELECT awb_number FROM orders WHERE id = $1', [orderId])
        if (orderWithAwb?.awb_number) {
          await cancelDelhiveryShipment(orderWithAwb.awb_number).catch(() => {})
        }
      }

      if (userEmail && userName) {
        if (statusChanged) {
          await sendOrderStatusUpdate(
            userEmail, userName, currentOrder.order_number, orderId, status,
            currentOrder.status, invoicePdfBuffer, undefined,
            status === 'shipped' ? tracking_url?.trim() : undefined
          ).catch(() => {})
        }
        if (paymentStatusChanged) {
          await sendPaymentStatusUpdate(
            userEmail, userName, currentOrder.order_number, orderId,
            payment_status, parseFloat(currentOrder.total_amount)
          ).catch(() => {})
        }
      }
    }

    notify().catch(() => {})
    return response
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to update order' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  return NextResponse.json({ error: 'Orders cannot be deleted.' }, { status: 405 })
}
