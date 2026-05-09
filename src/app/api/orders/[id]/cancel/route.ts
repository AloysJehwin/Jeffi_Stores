import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany, query } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendOrderStatusUpdate } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'

const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id
    const body = await request.json().catch(() => ({}))
    const restoreToCart = body?.restoreToCart === true

    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.user_id, o.customer_name, o.customer_email,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: `Cancellation cannot be requested — current status is "${order.status}"` },
        { status: 400 }
      )
    }

    if (order.status === 'pending' && (order.payment_status === 'unpaid' || order.payment_status === 'failed')) {
      const orderItems = await queryMany(
        'SELECT product_id, variant_id, quantity, unit_price FROM order_items WHERE order_id = $1',
        [orderId]
      )
      for (const item of orderItems) {
        const qty = parseFloat(item.quantity)
        if (item.variant_id) {
          await query(
            'UPDATE product_variants SET stock_quantity = stock_quantity + $1 WHERE id = $2',
            [qty, item.variant_id]
          )
        } else {
          await query(
            'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
            [qty, item.product_id]
          )
        }
        await logStockMovement(null, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          transactionType: 'return',
          quantityChange: qty,
          referenceType: 'order',
          referenceId: orderId,
        })
      }

      if (restoreToCart) {
        for (const item of orderItems) {
          const existingCartItem = await queryOne(
            'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3',
            [authUser.userId, item.product_id, item.variant_id || null]
          )
          if (existingCartItem) {
            await query(
              'UPDATE cart_items SET quantity = cart_items.quantity + $1, updated_at = NOW() WHERE id = $2',
              [item.quantity, existingCartItem.id]
            )
          } else {
            await query(
              'INSERT INTO cart_items (user_id, product_id, variant_id, quantity, price_at_addition) VALUES ($1, $2, $3, $4, $5)',
              [authUser.userId, item.product_id, item.variant_id || null, item.quantity, item.unit_price]
            )
          }
        }
      }

      await query(
        `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [orderId]
      )
      return NextResponse.json({ success: true, directCancel: true, restoredToCart: restoreToCart })
    }

    await query(
      `UPDATE orders SET status = 'cancel_requested', updated_at = NOW() WHERE id = $1`,
      [orderId]
    )

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

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to request cancellation' }, { status: 500 })
  }
}
