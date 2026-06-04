import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateUser, authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'
import { cancelDelhiveryShipment } from '@/lib/delhivery'
import { logStockMovement } from '@/lib/inventory'
import { logActivity } from '@/lib/activity'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { attributeConversion } from '@/lib/marketing'

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
        COALESCE(
          o.shipping_address_snapshot,
          (SELECT to_jsonb(a) FROM (
            SELECT full_name, address_line1, address_line2, landmark, city, state, postal_code, phone
            FROM addresses WHERE id = o.shipping_address_id
          ) a)
        ) AS shipping_address,
        orig.order_number AS original_order_number
      FROM orders o
      LEFT JOIN orders orig ON orig.id = o.original_order_id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const orderItems = await queryMany(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.product_sku, oi.variant_name, oi.quantity, oi.unit_price, oi.total_price, oi.buy_mode, oi.buy_unit,
        psv.sub_variant_name, psv.sku AS sub_variant_sku,
        json_build_object('slug', p.slug, 'product_images',
          COALESCE(
            (SELECT json_agg(pi ORDER BY pi.display_order)
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products,
        COALESCE(
          (CASE WHEN b.return_allowed IS NULL AND c.return_allowed IS NULL AND pc.return_allowed IS NULL THEN true
                ELSE COALESCE(b.return_allowed, true) AND COALESCE(c.return_allowed, true) AND COALESCE(pc.return_allowed, true)
           END),
          true
        ) AS return_allowed,
        LEAST(
          COALESCE(b.return_window_days, 9999),
          COALESCE(c.return_window_days, 9999),
          COALESCE(pc.return_window_days, 9999),
          7
        ) AS return_window_days,
        COALESCE(
          (CASE WHEN b.replacement_allowed IS NULL AND c.replacement_allowed IS NULL AND pc.replacement_allowed IS NULL THEN true
                ELSE COALESCE(b.replacement_allowed, true) AND COALESCE(c.replacement_allowed, true) AND COALESCE(pc.replacement_allowed, true)
           END),
          true
        ) AS replacement_allowed,
        LEAST(
          COALESCE(b.replacement_window_days, 9999),
          COALESCE(c.replacement_window_days, 9999),
          COALESCE(pc.replacement_window_days, 9999),
          7
        ) AS replacement_window_days
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_sub_variants psv ON oi.sub_variant_id = psv.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_category_id = pc.id
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
      orderType: order.order_type || 'cart',
      shippingAddress: order.shipping_address,
      items: orderItems.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        productSku: item.product_sku || null,
        variantName: item.variant_name || null,
        subVariantName: item.sub_variant_name || null,
        subVariantSku: item.sub_variant_sku || null,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unit_price),
        totalPrice: parseFloat(item.total_price),
        buyMode: item.buy_mode || 'unit',
        buyUnit: item.buy_unit || null,
        products: item.products,
        returnAllowed: item.return_allowed === false ? false : !!item.return_allowed,
        returnWindowDays: parseInt(item.return_window_days) || 7,
        replacementAllowed: item.replacement_allowed === false ? false : !!item.replacement_allowed,
        replacementWindowDays: parseInt(item.replacement_window_days) || 7,
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
    const { status, payment_status } = body

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
      shipped:          ['out_for_delivery', 'delivered'],
      out_for_delivery: ['delivered'],
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

    if (statusChanged && status === 'processing') {
      const items = await queryMany<any>(
        `SELECT oi.product_id, oi.variant_id, oi.quantity,
          CASE WHEN oi.variant_id IS NOT NULL
            THEN (SELECT inventory_quantity FROM product_variants WHERE id = oi.variant_id)
            ELSE (SELECT inventory_quantity FROM products WHERE id = oi.product_id)
          END AS inventory_quantity
         FROM order_items oi WHERE oi.order_id = $1`,
        [orderId]
      )
      const insufficient = items.filter((item: any) => Number(item.inventory_quantity) < parseFloat(item.quantity))
      if (insufficient.length > 0) {
        return NextResponse.json(
          { error: 'Insufficient stock for one or more items. Update inventory before marking as processing.' },
          { status: 400 }
        )
      }
    }

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

    if (status === 'shipped') {
      updates.push(`shipped_at = COALESCE(shipped_at, NOW())`)
    }

    if (status === 'delivered') {
      updates.push(`delivered_at = NOW()`)
    }

    values.push(orderId)

    await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    )

    if (currentOrder.user_id) {
      if (statusChanged) {
        logActivity({
          userId: currentOrder.user_id,
          actorId: admin.adminId,
          kind: 'order_status',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `Order #${currentOrder.order_number}: ${currentOrder.status} → ${status}`,
          metadata: { from: currentOrder.status, to: status, orderNumber: currentOrder.order_number },
        }).catch(() => {})

        if (status === 'cancelled' && currentOrder.payment_status === 'paid' && (payment_status !== 'refunded')) {
          createAutoTask({
            userId: currentOrder.user_id,
            sourceKind: 'process_refund',
            sourceRefId: orderId,
            title: `Issue refund for cancelled #${currentOrder.order_number}`,
            description: `Order was paid (₹${currentOrder.total_amount}) and is now cancelled — refund the customer.`,
            priority: 'urgent',
            dueInDays: 0,
          }).catch(() => {})
        }

        if (status === 'processing') {
          completeAutoTask('process_confirmed', orderId, { actorAdminId: admin.adminId }).catch(() => {})
        }
        if (status === 'shipped' || status === 'dispatched') {
          completeAutoTask('stuck_processing', orderId, { actorAdminId: admin.adminId }).catch(() => {})
        }
        if (status === 'out_for_delivery' || status === 'delivered') {
          completeAutoTask('stuck_shipment', orderId, { actorAdminId: admin.adminId }).catch(() => {})
        }
        if (status === 'delivered') {
          completeAutoTask('ndr_check', orderId, { actorAdminId: admin.adminId }).catch(() => {})
          if (currentOrder.payment_status === 'cod' || payment_status === 'cod') {
            createAutoTask({
              userId: currentOrder.user_id,
              sourceKind: 'confirm_cod_payment',
              sourceRefId: orderId,
              title: `Confirm COD payment for #${currentOrder.order_number}`,
              description: `Order delivered. Confirm cash collected and update payment_status to paid.`,
              priority: 'medium',
              dueInDays: 1,
            }).catch(() => {})
          }
        }
      }
      if (paymentStatusChanged) {
        logActivity({
          userId: currentOrder.user_id,
          actorId: admin.adminId,
          kind: 'payment_status',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `Order #${currentOrder.order_number} payment: ${currentOrder.payment_status} → ${payment_status}`,
          metadata: { from: currentOrder.payment_status, to: payment_status, orderNumber: currentOrder.order_number },
        }).catch(() => {})

        if (payment_status === 'failed') {
          createAutoTask({
            userId: currentOrder.user_id,
            sourceKind: 'contact_failed_payment',
            sourceRefId: orderId,
            title: `Reach out about failed payment on #${currentOrder.order_number}`,
            description: `Payment failed for ₹${currentOrder.total_amount}. Customer may need help retrying.`,
            priority: 'medium',
            dueInDays: 1,
          }).catch(() => {})
        }
        if (payment_status === 'refunded') {
          completeAutoTask('process_refund', orderId, { actorAdminId: admin.adminId }).catch(() => {})
          completeAutoTask('chase_refund', orderId, { actorAdminId: admin.adminId }).catch(() => {})
        }
        if (payment_status === 'paid' && currentOrder.payment_status === 'cod') {
          completeAutoTask('confirm_cod_payment', orderId, { actorAdminId: admin.adminId }).catch(() => {})
        }
        if (payment_status === 'paid' && currentOrder.user_id) {
          attributeConversion(currentOrder.user_id, orderId).catch(() => {})
        }
      }
    }

    if (statusChanged && status === 'processing') {
      const items = await queryMany<any>(
        `SELECT oi.product_id, oi.variant_id, oi.quantity
         FROM order_items oi WHERE oi.order_id = $1`,
        [orderId]
      )
      await withTransaction(async (client) => {
        for (const item of items) {
          const qty = parseFloat(item.quantity)
          if (item.variant_id) {
            await client.query(
              'UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
              [qty, item.variant_id]
            )
          } else {
            await client.query(
              'UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
              [qty, item.product_id]
            )
          }
          await logStockMovement(client, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            transactionType: 'sale',
            quantityChange: -qty,
            referenceType: 'order',
            referenceId: orderId,
          })
        }
      })
    }

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
            currentOrder.status, invoicePdfBuffer
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const order = await queryOne<{
      id: string
      status: string
      payment_status: string
      committed_payment_count: number
    }>(
      `SELECT o.id, o.status, o.payment_status,
        (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id AND p.status NOT IN ('pending', 'failed'))::int AS committed_payment_count
       FROM orders o
       WHERE o.id = $1 AND o.user_id = $2`,
      [params.id, authUser.userId]
    )

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (
      order.status !== 'pending' ||
      order.payment_status !== 'unpaid' ||
      order.committed_payment_count > 0
    ) {
      return NextResponse.json(
        { error: 'Order cannot be deleted in its current state' },
        { status: 400 }
      )
    }

    const orderItems = await queryMany<{
      product_id: string
      variant_id: string | null
      sub_variant_id: string | null
      quantity: string
      unit_price: string
      buy_mode: string
      buy_unit: string | null
    }>(
      `SELECT product_id, variant_id, sub_variant_id, quantity, unit_price, buy_mode, buy_unit
       FROM order_items WHERE order_id = $1`,
      [params.id]
    )
    for (const item of orderItems) {
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM cart_items WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3 AND sub_variant_id IS NOT DISTINCT FROM $4 AND buy_mode = $5`,
        [authUser.userId, item.product_id, item.variant_id || null, item.sub_variant_id || null, item.buy_mode || 'unit']
      )
      if (existing) {
        await query(`UPDATE cart_items SET quantity = $1, price_at_addition = $2, updated_at = NOW() WHERE id = $3`, [item.quantity, item.unit_price, existing.id])
      } else {
        await query(
          `INSERT INTO cart_items (user_id, product_id, variant_id, sub_variant_id, quantity, price_at_addition, buy_mode, buy_unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [authUser.userId, item.product_id, item.variant_id || null, item.sub_variant_id || null, item.quantity, item.unit_price, item.buy_mode || 'unit', item.buy_unit || null]
        )
      }
    }

    await query('DELETE FROM orders WHERE id = $1 AND user_id = $2', [params.id, authUser.userId])

    return NextResponse.json({ success: true, deleted: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 })
  }
}
