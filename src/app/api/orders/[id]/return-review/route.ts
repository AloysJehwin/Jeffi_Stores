import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query, queryMany, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { sendReturnStatusEmail, sendPaymentStatusUpdate } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { logActivity } from '@/lib/activity'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id
    const body = await request.json()
    const { action, adminNotes, returnTrackingNumber, restock } = body

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

      completeAutoTask('review_return', orderId, { actorAdminId: admin.adminId }).catch(() => {})
      if (order.user_id) {
        createAutoTask({
          userId: order.user_id,
          sourceKind: 'schedule_pickup',
          sourceRefId: orderId,
          title: `Schedule return pickup for #${order.order_number}`,
          priority: 'high',
          dueInDays: 1,
        }).catch(() => {})

        logActivity({
          userId: order.user_id,
          actorId: admin.adminId,
          kind: 'return_status',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `${returnRequest.type === 'replacement' ? 'Replacement' : 'Return'} approved for #${order.order_number}`,
          metadata: { return_type: returnRequest.type, status: 'return_approved' },
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

      completeAutoTask('review_return', orderId, { actorAdminId: admin.adminId }).catch(() => {})

      if (order.user_id) {
        logActivity({
          userId: order.user_id,
          actorId: admin.adminId,
          kind: 'return_status',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `${returnRequest.type === 'replacement' ? 'Replacement' : 'Return'} rejected for #${order.order_number}: ${adminNotes.trim()}`,
          metadata: { return_type: returnRequest.type, status: 'return_rejected', notes: adminNotes.trim() },
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

      completeAutoTask('schedule_pickup', orderId, { actorAdminId: admin.adminId }).catch(() => {})
      if (order.user_id) {
        createAutoTask({
          userId: order.user_id,
          sourceKind: 'inspect_refund',
          sourceRefId: orderId,
          title: `Inspect returned item & process refund for #${order.order_number}`,
          priority: 'high',
          dueInDays: 2,
        }).catch(() => {})

        logActivity({
          userId: order.user_id,
          actorId: admin.adminId,
          kind: 'return_status',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `Return parcel received for #${order.order_number}`,
          metadata: { return_type: returnRequest.type, status: 'return_received', tracking: returnTrackingNumber || null },
        }).catch(() => {})
      }

      return NextResponse.json({ success: true, newStatus: 'return_received' })
    }

    if (action === 'process') {
      if (order.status !== 'return_received') {
        return NextResponse.json({ error: `Cannot process — order status is "${order.status}"` }, { status: 400 })
      }

      // Fetch the specific items being returned
      const returnItems: any[] = await queryMany(
        `SELECT rri.*, oi.sub_variant_id
         FROM return_request_items rri
         JOIN order_items oi ON oi.id = rri.order_item_id
         WHERE rri.return_request_id = $1`,
        [returnRequest.id]
      )

      // Fall back to all order items if no item-level records (legacy requests)
      const useItemLevel = returnItems.length > 0

      const refundAmount = useItemLevel
        ? returnItems.reduce((sum: number, i: any) => sum + parseFloat(i.refund_amount), 0)
        : parseFloat(order.total_amount)

      async function restockItems(client: any) {
        const itemsToRestock = useItemLevel
          ? returnItems
          : (await client.query('SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1', [orderId])).rows

        for (const item of itemsToRestock) {
          const qty = parseFloat(useItemLevel ? item.quantity : item.quantity)
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
              const amountInPaise = Math.round(refundAmount * 100)
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
                if (restock !== false) await restockItems(client)
              })

              if (userEmail && userName) {
                sendPaymentStatusUpdate(
                  userEmail, userName, order.order_number, orderId,
                  'refunded', refundAmount
                ).catch(() => {})
              }

              completeAutoTask('inspect_refund', orderId, { actorAdminId: admin.adminId }).catch(() => {})

              if (order.user_id) {
                logActivity({
                  userId: order.user_id,
                  actorId: admin.adminId,
                  kind: 'return_status',
                  referenceId: orderId,
                  referenceType: 'orders',
                  summary: `Refund of ₹${refundAmount.toFixed(0)} processed for #${order.order_number}`,
                  metadata: { return_type: 'refund', status: 'returned', amount: refundAmount },
                }).catch(() => {})
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
          if (restock !== false) await restockItems(client)
        })

        completeAutoTask('inspect_refund', orderId, { actorAdminId: admin.adminId }).catch(() => {})

        if (order.user_id) {
          logActivity({
            userId: order.user_id,
            actorId: admin.adminId,
            kind: 'return_status',
            referenceId: orderId,
            referenceType: 'orders',
            summary: refundFailed
              ? `Refund failed for #${order.order_number} — manual intervention needed`
              : `Return marked complete for #${order.order_number}`,
            metadata: { return_type: 'refund', status: 'returned', refundFailed },
          }).catch(() => {})
        }

        return NextResponse.json({ success: true, newStatus: 'returned', refundFailed })
      }

      if (returnRequest.type === 'replacement') {
        const originalOrder = await queryOne(
          `SELECT o.*,
            COALESCE((o.shipping_address_snapshot->>'full_name'), a.full_name) AS full_name,
            COALESCE((o.shipping_address_snapshot->>'address_line1'), a.address_line1) AS address_line1,
            COALESCE((o.shipping_address_snapshot->>'address_line2'), a.address_line2) AS address_line2,
            COALESCE((o.shipping_address_snapshot->>'landmark'), a.landmark) AS landmark,
            COALESCE((o.shipping_address_snapshot->>'city'), a.city) AS city,
            COALESCE((o.shipping_address_snapshot->>'state'), a.state) AS state,
            COALESCE((o.shipping_address_snapshot->>'postal_code'), a.postal_code) AS postal_code,
            COALESCE((o.shipping_address_snapshot->>'phone'), a.phone) AS phone,
            COALESCE((o.shipping_address_snapshot->>'country'), a.country) AS country
           FROM orders o
           LEFT JOIN addresses a ON a.id = o.shipping_address_id
           WHERE o.id = $1`,
          [orderId]
        )

        // Items for replacement: only the returned items (item-level), else all order items
        const replacementItems: any[] = useItemLevel
          ? returnItems
          : (await queryMany('SELECT * FROM order_items WHERE order_id = $1', [orderId]))

        const replacementTotal = useItemLevel
          ? refundAmount
          : parseFloat(order.total_amount)

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
              $2, 0, 0, 0, $2,
              shipping_address_id, customer_name, customer_email,
              'Replacement for order #' || order_number,
              id
            FROM orders WHERE id = $1
            RETURNING id, order_number`,
            [orderId, replacementTotal]
          )

          const newOrder = newOrderResult.rows[0]
          newOrderId = newOrder.id
          newOrderNumber = newOrder.order_number

          for (const item of replacementItems) {
            const qty = parseFloat(item.quantity)
            const unitPrice = parseFloat(item.unit_price)
            await client.query(
              `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, quantity, unit_price, total_price, buy_mode, buy_unit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                newOrderId,
                item.product_id,
                item.variant_id || null,
                item.product_name,
                item.variant_name || null,
                qty,
                unitPrice,
                parseFloat((qty * unitPrice).toFixed(2)),
                item.buy_mode || 'unit',
                item.buy_unit || null,
              ]
            )
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

          if (restock !== false) await restockItems(client)
        })

        if (userEmail && userName) {
          sendReturnStatusEmail(userEmail, userName, order.order_number, orderId, 'replacement_created', {
            replacementOrderNumber: newOrderNumber!,
          }).catch(() => {})
        }

        completeAutoTask('inspect_refund', orderId, { actorAdminId: admin.adminId }).catch(() => {})

        if (order.user_id) {
          logActivity({
            userId: order.user_id,
            actorId: admin.adminId,
            kind: 'return_status',
            referenceId: orderId,
            referenceType: 'orders',
            summary: `Replacement order #${newOrderNumber!} created for return on #${order.order_number}`,
            metadata: { return_type: 'replacement', status: 'returned', replacement_order_id: newOrderId!, replacement_order_number: newOrderNumber! },
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
