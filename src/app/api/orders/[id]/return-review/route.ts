import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { sendReturnStatusEmail, sendPaymentStatusUpdate } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'

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
    const { action, adminNotes, returnTrackingNumber } = body

    const VALID_ACTIONS = ['approve', 'reject', 'mark_received', 'process']
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    if (action === 'reject' && (!adminNotes || !adminNotes.trim())) {
      return NextResponse.json({ error: 'Admin notes are required when rejecting a return.' }, { status: 400 })
    }

    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.user_id, o.original_order_id,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [orderId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const returnRequest = await queryOne(
      `SELECT * FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected', 'completed') ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    )

    if (!returnRequest) {
      return NextResponse.json({ error: 'No active return request found for this order.' }, { status: 404 })
    }

    const user = order.users
    const userEmail = user?.email || order.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

    if (action === 'approve') {
      if (order.status !== 'return_requested') {
        return NextResponse.json({ error: `Cannot approve — order status is "${order.status}"` }, { status: 400 })
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE return_requests SET status = 'approved', admin_notes = $1, updated_at = NOW() WHERE id = $2`,
          [adminNotes?.trim() || null, returnRequest.id]
        )
        await client.query(
          `UPDATE orders SET status = 'return_approved', updated_at = NOW() WHERE id = $1`,
          [orderId]
        )
      })

      if (userEmail && userName) {
        sendReturnStatusEmail(userEmail, userName, order.order_number, orderId, 'approved', {
          returnType: returnRequest.type,
        }).catch(() => {})
      }

      return NextResponse.json({ success: true, newStatus: 'return_approved' })
    }

    if (action === 'reject') {
      if (order.status !== 'return_requested') {
        return NextResponse.json({ error: `Cannot reject — order status is "${order.status}"` }, { status: 400 })
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE return_requests SET status = 'rejected', admin_notes = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [adminNotes.trim(), returnRequest.id]
        )
        await client.query(
          `UPDATE orders SET status = 'return_rejected', updated_at = NOW() WHERE id = $1`,
          [orderId]
        )
      })

      if (userEmail && userName) {
        sendReturnStatusEmail(userEmail, userName, order.order_number, orderId, 'rejected', {
          adminNotes: adminNotes.trim(),
        }).catch(() => {})
      }

      return NextResponse.json({ success: true, newStatus: 'return_rejected' })
    }

    if (action === 'mark_received') {
      if (order.status !== 'return_approved') {
        return NextResponse.json({ error: `Cannot mark received — order status is "${order.status}"` }, { status: 400 })
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE return_requests SET status = 'received', return_tracking_number = $1, received_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [returnTrackingNumber?.trim() || null, returnRequest.id]
        )
        await client.query(
          `UPDATE orders SET status = 'return_received', updated_at = NOW() WHERE id = $1`,
          [orderId]
        )
      })

      if (userEmail && userName) {
        sendReturnStatusEmail(userEmail, userName, order.order_number, orderId, 'received', {
          returnType: returnRequest.type,
        }).catch(() => {})
      }

      return NextResponse.json({ success: true, newStatus: 'return_received' })
    }

    if (action === 'process') {
      if (order.status !== 'return_received') {
        return NextResponse.json({ error: `Cannot process — order status is "${order.status}"` }, { status: 400 })
      }

      if (returnRequest.type === 'refund') {
        let refundFailed = false

        const paymentOrderId = order.original_order_id || orderId
        const effectivePaymentStatus = order.original_order_id
          ? (await queryOne(`SELECT payment_status FROM orders WHERE id = $1`, [paymentOrderId]))?.payment_status
          : order.payment_status

        if (effectivePaymentStatus === 'paid' && isRazorpayEnabled()) {
          const paymentRecord = await queryOne(
            `SELECT id, transaction_id, amount, gateway_response FROM payments
             WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed'
             LIMIT 1`,
            [paymentOrderId]
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
                  `UPDATE orders SET status = 'returned', payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
                  [orderId]
                )
                if (order.original_order_id) {
                  await client.query(
                    `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
                    [order.original_order_id]
                  )
                }
                await client.query(
                  `UPDATE payments SET status = 'refunded', gateway_response = $1, updated_at = NOW() WHERE id = $2`,
                  [JSON.stringify({ ...(typeof paymentRecord.gateway_response === 'string' ? JSON.parse(paymentRecord.gateway_response) : paymentRecord.gateway_response || {}), refund }), paymentRecord.id]
                )
                await client.query(
                  `UPDATE return_requests SET status = 'completed', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
                  [returnRequest.id]
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

              if (userEmail && userName) {
                sendPaymentStatusUpdate(
                  userEmail, userName, order.order_number, orderId,
                  'refunded', parseFloat(order.total_amount)
                ).catch(() => {})
              }

              return NextResponse.json({ success: true, newStatus: 'returned', refundFailed: false })
            } catch {
              refundFailed = true
            }
          }
        }

        await withTransaction(async (client) => {
          await client.query(
            `UPDATE orders SET status = 'returned', updated_at = NOW() WHERE id = $1`,
            [orderId]
          )
          await client.query(
            `UPDATE return_requests SET status = 'completed', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [returnRequest.id]
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

        return NextResponse.json({ success: true, newStatus: 'returned', refundFailed })
      }

      if (returnRequest.type === 'replacement') {
        const originalOrder = await queryOne(
          `SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.landmark, a.city, a.state, a.postal_code, a.phone, a.country
           FROM orders o
           LEFT JOIN addresses a ON a.id = o.shipping_address_id
           WHERE o.id = $1`,
          [orderId]
        )

        const originalItems = await queryOne(
          'SELECT json_agg(oi) AS items FROM order_items oi WHERE oi.order_id = $1',
          [orderId]
        )

        const items: any[] = originalItems?.items || []

        let newOrderId: string
        let newOrderNumber: string

        await withTransaction(async (client) => {
          const newOrderResult = await client.query(
            `INSERT INTO orders (
              user_id, order_number, status, payment_status, subtotal, tax_amount,
              shipping_amount, discount_amount, total_amount, shipping_address_id,
              customer_name, customer_email, notes, original_order_id
            )
            SELECT user_id,
              'RPL-' || order_number,
              'confirmed',
              'paid',
              subtotal, tax_amount, shipping_amount, discount_amount, total_amount,
              shipping_address_id, customer_name, customer_email,
              'Replacement for order #' || order_number,
              id
            FROM orders WHERE id = $1
            RETURNING id, order_number`,
            [orderId]
          )

          const newOrder = newOrderResult.rows[0]
          newOrderId = newOrder.id
          newOrderNumber = newOrder.order_number

          for (const item of items) {
            await client.query(
              `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, quantity, unit_price, total_price, buy_mode, buy_unit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [newOrderId, item.product_id, item.variant_id || null, item.product_name, item.variant_name, item.quantity, item.unit_price, item.total_price, item.buy_mode, item.buy_unit]
            )
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
              referenceId: newOrderId,
            })
          }

          await client.query(
            `UPDATE return_requests SET status = 'completed', replacement_order_id = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [newOrderId, returnRequest.id]
          )

          await client.query(
            `UPDATE orders SET status = 'returned', updated_at = NOW() WHERE id = $1`,
            [orderId]
          )

          const returnedItemsResult = await client.query(
            'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
            [orderId]
          )
          for (const item of returnedItemsResult.rows) {
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

        if (userEmail && userName) {
          sendReturnStatusEmail(userEmail, userName, order.order_number, orderId, 'replacement_created', {
            replacementOrderNumber: newOrderNumber!,
          }).catch(() => {})
        }

        return NextResponse.json({ success: true, newStatus: 'returned', replacementOrderId: newOrderId!, replacementOrderNumber: newOrderNumber! })
      }
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to process return review' }, { status: 500 })
  }
}
