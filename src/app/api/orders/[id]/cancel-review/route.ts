import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'
import { cancelDelhiveryShipment } from '@/lib/delhivery'
import { logStockMovement } from '@/lib/inventory'

export async function POST(
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
    const { action, note } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject".' }, { status: 400 })
    }

    if (action === 'reject' && (!note || !note.trim())) {
      return NextResponse.json({ error: 'A reason is required when rejecting a cancellation.' }, { status: 400 })
    }

    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.user_id, o.awb_number,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [orderId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.status !== 'cancel_requested') {
      return NextResponse.json(
        { error: `Order is not pending cancellation — current status is "${order.status}"` },
        { status: 400 }
      )
    }

    let newStatus: string
    let refundFailed = false

    if (action === 'approve') {
      let refundSuccess = false
      if (order.payment_status === 'paid' && isRazorpayEnabled()) {
        const paymentRecord = await queryOne(
          `SELECT id, transaction_id, amount, gateway_response FROM payments
           WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed'
           LIMIT 1`,
          [orderId]
        )

        if (paymentRecord && paymentRecord.transaction_id) {
          try {
            const razorpay = getRazorpayInstance()
            const amountInPaise = Math.round(parseFloat(paymentRecord.amount) * 100)
            const refund = await razorpay.payments.refund(paymentRecord.transaction_id, {
              amount: amountInPaise,
            })

            await withTransaction(async (client) => {
              await client.query(
                `UPDATE orders SET status = 'cancelled', payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
                [orderId]
              )
              await client.query(
                `UPDATE payments SET status = 'refunded', gateway_response = $1, updated_at = NOW() WHERE id = $2`,
                [JSON.stringify({ ...(typeof paymentRecord.gateway_response === 'string' ? JSON.parse(paymentRecord.gateway_response) : paymentRecord.gateway_response || {}), refund }), paymentRecord.id]
              )
              const itemsResult = await client.query(
                'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
                [orderId]
              )
              for (const item of itemsResult.rows) {
                const qty = parseFloat(item.quantity)
                if (item.variant_id) {
                  await client.query(
                    'UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                    [qty, item.variant_id]
                  )
                } else {
                  await client.query(
                    'UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                    [qty, item.product_id]
                  )
                }
                await logStockMovement(client, {
                  productId: item.product_id,
                  variantId: item.variant_id || null,
                  transactionType: 'return',
                  quantityChange: qty,
                  referenceType: 'order',
                  referenceId: orderId,
                })
              }
            })
            refundSuccess = true
          } catch {
            refundFailed = true
            await withTransaction(async (client) => {
              await client.query(
                `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
                [orderId]
              )
              const itemsResult = await client.query(
                'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
                [orderId]
              )
              for (const item of itemsResult.rows) {
                const qty = parseFloat(item.quantity)
                if (item.variant_id) {
                  await client.query(
                    'UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                    [qty, item.variant_id]
                  )
                } else {
                  await client.query(
                    'UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                    [qty, item.product_id]
                  )
                }
                await logStockMovement(client, {
                  productId: item.product_id,
                  variantId: item.variant_id || null,
                  transactionType: 'return',
                  quantityChange: qty,
                  referenceType: 'order',
                  referenceId: orderId,
                })
              }
            })
          }
        } else {
          await withTransaction(async (client) => {
            await client.query(
              `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
              [orderId]
            )
            const itemsResult = await client.query(
              'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
              [orderId]
            )
            for (const item of itemsResult.rows) {
              const qty = parseFloat(item.quantity)
              if (item.variant_id) {
                await client.query(
                  'UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                  [qty, item.variant_id]
                )
              } else {
                await client.query(
                  'UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                  [qty, item.product_id]
                )
              }
              await logStockMovement(client, {
                productId: item.product_id,
                variantId: item.variant_id || null,
                transactionType: 'return',
                quantityChange: qty,
                referenceType: 'order',
                referenceId: orderId,
              })
            }
          })
        }
      } else {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
            [orderId]
          )
          const itemsResult = await client.query(
            'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
            [orderId]
          )
          for (const item of itemsResult.rows) {
            const qty = parseFloat(item.quantity)
            if (item.variant_id) {
              await client.query(
                'UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                [qty, item.variant_id]
              )
            } else {
              await client.query(
                'UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2',
                [qty, item.product_id]
              )
            }
            await logStockMovement(client, {
              productId: item.product_id,
              variantId: item.variant_id || null,
              transactionType: 'return',
              quantityChange: qty,
              referenceType: 'order',
              referenceId: orderId,
            })
          }
        })
      }
      newStatus = 'cancelled'

      if (order.awb_number) {
        await cancelDelhiveryShipment(order.awb_number).catch(() => {})
      }

      if (refundSuccess) {
        const refundUser = order.users
        const refundEmail = refundUser?.email || order.customer_email
        const refundName = refundUser ? `${refundUser.first_name || ''} ${refundUser.last_name || ''}`.trim() : order.customer_name
        if (refundEmail && refundName) {
          sendPaymentStatusUpdate(
            refundEmail, refundName, order.order_number, orderId,
            'refunded', parseFloat(order.total_amount)
          ).catch(() => {})
        }
      }
    } else {
      await query(
        `UPDATE orders SET status = 'cancel_rejected', cancellation_note = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, note.trim()]
      )
      newStatus = 'cancel_rejected'
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
        newStatus,
        'cancel_requested',
        null,
        newStatus === 'cancel_rejected' ? note.trim() : undefined
      ).catch(() => {})
    }

    return NextResponse.json({ success: true, newStatus, refundFailed })
  } catch {
    return NextResponse.json({ error: 'Failed to process cancellation review' }, { status: 500 })
  }
}
