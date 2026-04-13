import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser, authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'

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

    // Fetch order with address
    const order = await queryOne(`
      SELECT o.*,
        (SELECT row_to_json(a) FROM (
          SELECT full_name, address_line1, address_line2, landmark, city, state, postal_code, phone
          FROM addresses WHERE id = o.shipping_address_id
        ) a) AS shipping_address
      FROM orders o
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Fetch order items with product images
    const orderItems = await queryMany(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.variant_name, oi.quantity, oi.unit_price, oi.total_price,
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
      status: order.status,
      paymentStatus: order.payment_status,
      createdAt: order.created_at,
      notes: order.notes,
      shippingAddress: order.shipping_address,
      items: orderItems.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        variantName: item.variant_name || null,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unit_price),
        totalPrice: parseFloat(item.total_price),
        products: item.products,
      })),
    }

    return NextResponse.json({ order: orderDetails })
  } catch (error) {
    console.error('Order fetch error:', error)
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
    const { status, payment_status } = body

    // First, get current order details and user info
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

    if (currentOrder.status === 'cancelled') {
      return NextResponse.json({ error: 'Cancelled orders cannot be modified' }, { status: 400 })
    }

    if (currentOrder.status === 'delivered' && status && status !== 'delivered') {
      return NextResponse.json({ error: 'Delivered orders cannot change status' }, { status: 400 })
    }

    // Validate status values
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancel_requested', 'cancelled']
    const validPaymentStatuses = ['pending', 'paid', 'failed', 'refunded']

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid order status: ${status}` }, { status: 400 })
    }

    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
      return NextResponse.json({ error: `Invalid payment status: ${payment_status}` }, { status: 400 })
    }

    // Prevent setting payment to 'paid' → 'pending' (refunded is the correct reverse path)
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

    values.push(orderId)

    // Update the order
    await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    )

    // Generate invoice when order moves to confirmed or processing AND payment is paid
    let invoicePdfBuffer: Buffer | null = null
    const effectivePaymentStatus = payment_status || currentOrder.payment_status
    if (statusChanged && (status === 'confirmed' || status === 'processing') && effectivePaymentStatus === 'paid') {
      try {
        invoicePdfBuffer = await generateOrderInvoice(orderId)
      } catch (err) {
        console.error('Failed to generate invoice:', err)
      }
    }

    // Also generate invoice if payment just changed to paid and order is already confirmed/processing
    const effectiveStatus = status || currentOrder.status
    if (paymentStatusChanged && payment_status === 'paid' && (effectiveStatus === 'confirmed' || effectiveStatus === 'processing')) {
      if (!invoicePdfBuffer) {
        try {
          invoicePdfBuffer = await generateOrderInvoice(orderId)
        } catch (err) {
          console.error('Failed to generate invoice:', err)
        }
      }
    }

    // Send email notifications if user exists
    const user = currentOrder.users
    const userEmail = user?.email || currentOrder.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : currentOrder.customer_name

    let statusEmailSent = false
    let paymentEmailSent = false

    if (userEmail && userName) {
      // Send order status update notification
      if (statusChanged) {
        const statusResult = await sendOrderStatusUpdate(
          userEmail,
          userName,
          currentOrder.order_number,
          orderId,
          status,
          currentOrder.status,
          invoicePdfBuffer
        )
        statusEmailSent = statusResult.success
      }

      // Send payment status update notification
      if (paymentStatusChanged) {
        const paymentResult = await sendPaymentStatusUpdate(
          userEmail,
          userName,
          currentOrder.order_number,
          orderId,
          payment_status,
          parseFloat(currentOrder.total_amount)
        )
        paymentEmailSent = paymentResult.success
      }
    }

    return NextResponse.json({
      success: true,
      notifications: {
        statusEmailSent,
        paymentEmailSent,
      },
    })
  } catch (error: any) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update order' },
      { status: 500 }
    )
  }
}
