import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query, queryMany, withTransaction, resolveRequestTenant } from '@/lib/db'
import { requireAdminScope } from '@/lib/jwt'
import { sendReturnStatusEmail, sendPaymentStatusUpdate } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/razorpay'
import { reverseTransfersForRefund, recordRefundSettlement } from '@/lib/razorpay-route'
import { controlPlanePool } from '@/lib/tenant-registry'
import { restoreOrderStock } from '@/lib/order-stock'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { logActivity } from '@/lib/activity'
import { getBusinessValues } from '@/lib/site-controls'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'orders:write')
    if (admin instanceof NextResponse) return admin

    const orderId = id
    const body = await request.json()
    const { action, adminNotes, returnTrackingNumber, restock, replacementVariants } = body
    // replacementVariants: optional map { [order_item_id]: { variant_id, sub_variant_id } }
    // the admin picks when the original variant/sub-variant of a replacement item no
    // longer exists (removed/deactivated by a later product edit). Used only for
    // action === 'process' on a replacement.
    const rvMap: Record<string, { variant_id: string | null; sub_variant_id: string | null }> =
      replacementVariants && typeof replacementVariants === 'object' ? replacementVariants : {}

    const VALID_ACTIONS = ['approve', 'reject', 'mark_received', 'process']
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    if (action === 'reject' && (!adminNotes || !adminNotes.trim())) {
      return NextResponse.json({ error: 'Admin notes are required when rejecting a return.' }, { status: 400 })
    }

    const order = await queryOne(
      `
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.user_id, o.original_order_id,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `,
      [orderId]
    )

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

      await withTransaction(async client => {
        await client.query(
          `UPDATE return_requests SET status = 'approved', admin_notes = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [adminNotes?.trim() || null, admin.adminId, returnRequest.id]
        )
        await client.query(`UPDATE orders SET status = 'return_approved', updated_at = NOW() WHERE id = $1`, [orderId])
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

      await withTransaction(async client => {
        await client.query(
          `UPDATE return_requests SET status = 'rejected', admin_notes = $1, reviewed_by = $2, reviewed_at = NOW(), resolved_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [adminNotes.trim(), admin.adminId, returnRequest.id]
        )
        await client.query(`UPDATE orders SET status = 'return_rejected', updated_at = NOW() WHERE id = $1`, [orderId])
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

      await withTransaction(async client => {
        await client.query(
          `UPDATE return_requests SET status = 'received', return_tracking_number = $1, reviewed_by = $2, reviewed_at = NOW(), received_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [returnTrackingNumber?.trim() || null, admin.adminId, returnRequest.id]
        )
        await client.query(`UPDATE orders SET status = 'return_received', updated_at = NOW() WHERE id = $1`, [orderId])
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
          metadata: {
            return_type: returnRequest.type,
            status: 'return_received',
            tracking: returnTrackingNumber || null,
          },
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

      const returnStandardCharge = (await getBusinessValues()).returnStandardCharge
      // The charge can only eat what was returnable, never more.
      const appliedCharge = Math.min(returnStandardCharge, refundAmount)
      const netRefundAmount = Math.max(0, Math.round((refundAmount - returnStandardCharge) * 100) / 100)
      const chargeBreakdown = { grossRefund: refundAmount, charge: appliedCharge, netRefund: netRefundAmount }

      if (returnRequest.type === 'refund') {
        let refundFailed = false

        const paymentOrderId = order.original_order_id || orderId
        const effectivePaymentStatus = order.original_order_id
          ? (await queryOne(`SELECT payment_status FROM orders WHERE id = $1`, [paymentOrderId]))?.payment_status
          : order.payment_status

        // When the return standard charge covers the whole returnable amount, netRefundAmount is
        // 0: no money goes back, so skip the Razorpay call entirely and fall through to the
        // manual completion below (which leaves payment_status untouched — nothing was refunded).
        if (netRefundAmount > 0 && effectivePaymentStatus === 'paid' && (await isRazorpayEnabled())) {
          // Refund EVERY completed Razorpay payment on the order — the initial charge AND any
          // later top-ups (e.g. a variant-change collection) — spreading netRefundAmount across
          // them. A single LIMIT 1 refund under-refunds the buyer whenever the return spans more
          // than one payment. Mirrors the direct-refund route.
          const paymentRecords = await queryMany<any>(
            `SELECT id, transaction_id, amount, gateway_response FROM payments
             WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed'
             ORDER BY created_at DESC`,
            [paymentOrderId]
          )
          const refundable = (paymentRecords || []).filter((p: any) => p.transaction_id)

          if (refundable.length > 0) {
            try {
              // Tenant-aware: an own_razorpay tenant collected on THEIR keys, so refunding from
              // platform keys fails outright.
              const tenant = await resolveRequestTenant()
              const ownRazorpay = tenant?.tenantId
                ? await controlPlanePool()
                    .query(`SELECT own_razorpay FROM tenants WHERE id=$1`, [tenant.tenantId])
                    .then(r => r.rows[0]?.own_razorpay === true)
                    .catch(() => false)
                : false
              const { instance: razorpay } = await getRazorpayInstanceFor(tenant?.tenantId)

              // Cap the spread at what was actually captured, so we never ask Razorpay to refund
              // more than a payment holds.
              const capturedTotal = refundable.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
              let remaining = Math.min(netRefundAmount, capturedTotal)
              const perPayment: { record: any; refund: any }[] = []
              let reversedInr = 0
              let unrecoveredInr = 0

              for (const paymentRecord of refundable) {
                if (remaining <= 0) break
                const captured = parseFloat(paymentRecord.amount) || 0
                const thisRefund = Math.min(captured, remaining)
                if (!(thisRefund > 0)) continue
                const amountInPaise = Math.round(thisRefund * 100)
                const refund = await razorpay.payments.refund(paymentRecord.transaction_id, {
                  amount: amountInPaise,
                })
                perPayment.push({ record: paymentRecord, refund })
                remaining = Math.round((remaining - thisRefund) * 100) / 100

                // Claw back the tenant's share of this PARTIAL return. Without this the buyer was
                // refunded from platform funds while the tenant kept 100% of their share.
                if (!ownRazorpay) {
                  const outcome = await reverseTransfersForRefund(paymentRecord.transaction_id, amountInPaise)
                  reversedInr += outcome.reversedPaise / 100
                  unrecoveredInr += outcome.unrecoveredPaise / 100
                  if (outcome.unrecoveredPaise > 0) {
                    console.error(
                      `[return-review] transfer reversal INCOMPLETE order=${orderId} payment=${paymentRecord.transaction_id} ` +
                        `unrecoveredPaise=${outcome.unrecoveredPaise}${outcome.lookupError ? ` lookupError=${outcome.lookupError}` : ''}`
                    )
                  }
                }
              }

              if (!ownRazorpay && tenant?.tenantId && (reversedInr > 0 || unrecoveredInr > 0)) {
                await recordRefundSettlement({
                  tenantId: tenant.tenantId,
                  orderRef: order.order_number,
                  refundedInr: netRefundAmount,
                  reversedInr,
                  unrecoveredInr,
                  note: 'return',
                })
              }

              await withTransaction(async client => {
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
                for (const { record, refund } of perPayment) {
                  await client.query(
                    `UPDATE payments SET status = 'refunded', gateway_response = $1, updated_at = NOW() WHERE id = $2`,
                    [
                      JSON.stringify({
                        ...(typeof record.gateway_response === 'string'
                          ? JSON.parse(record.gateway_response)
                          : record.gateway_response || {}),
                        refund,
                      }),
                      record.id,
                    ]
                  )
                }
                await client.query(
                  `UPDATE return_requests SET status = 'completed', reviewed_by = $1, reviewed_at = NOW(), resolved_at = NOW(), updated_at = NOW() WHERE id = $2`,
                  [admin.adminId, returnRequest.id]
                )
              })

              let stockWarnings: string[] = []
              if (restock !== false) {
                const r = await restoreOrderStock(orderId).catch(() => ({ skipped: [] as any[] }))
                stockWarnings = (r?.skipped || []).map((s: any) => s.reason)
              }

              if (userEmail && userName) {
                sendPaymentStatusUpdate(
                  userEmail,
                  userName,
                  order.order_number,
                  orderId,
                  'refunded',
                  netRefundAmount
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

              return NextResponse.json({
                success: true,
                newStatus: 'returned',
                refundFailed: false,
                stockWarnings,
                ...chargeBreakdown,
              })
            } catch {
              refundFailed = true
            }
          }
        }

        await withTransaction(async client => {
          await client.query(`UPDATE orders SET status = 'returned', updated_at = NOW() WHERE id = $1`, [orderId])
          await client.query(
            `UPDATE return_requests SET status = 'completed', reviewed_by = $1, reviewed_at = NOW(), resolved_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [admin.adminId, returnRequest.id]
          )
          // Refund fully absorbed by the return charge: record WHY on the completed payment so
          // both the admin panel and the customer page can explain the zero refund. payment_status
          // is deliberately left as 'paid' — no money went back.
          if (netRefundAmount <= 0 && effectivePaymentStatus === 'paid') {
            await client.query(
              `UPDATE payments SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
               WHERE order_id = $2 AND payment_gateway = 'razorpay' AND status = 'completed'`,
              [JSON.stringify({ returnCharge: chargeBreakdown }), paymentOrderId]
            )
          }
        })

        let stockWarnings: string[] = []
        if (restock !== false) {
          const r = await restoreOrderStock(orderId).catch(() => ({ skipped: [] as any[] }))
          stockWarnings = (r?.skipped || []).map((s: any) => s.reason)
        }

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

        return NextResponse.json({
          success: true,
          newStatus: 'returned',
          refundFailed,
          stockWarnings,
          ...chargeBreakdown,
        })
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
          : await queryMany('SELECT * FROM order_items WHERE order_id = $1', [orderId])

        const replacementTotal = useItemLevel ? refundAmount : parseFloat(order.total_amount)

        // Resolve the effective grain to ship for each replacement item. If the
        // original variant/sub-variant is gone/inactive, the admin must supply an
        // override via replacementVariants (keyed by order_item_id); we validate the
        // override resolves to an ACTIVE grain of the SAME product. Missing overrides
        // for gone grains → 409 with the list, so the UI can prompt a variant picker.
        const isActiveVariant = async (vid: string | null): Promise<boolean> => {
          if (!vid) return true
          const r = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM product_variants WHERE id = $1`, [
            vid,
          ])
          return !!r && r.is_active !== false
        }
        const isActiveSubVariant = async (svid: string | null): Promise<boolean> => {
          if (!svid) return true
          const r = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM product_sub_variants WHERE id = $1`, [
            svid,
          ])
          return !!r && r.is_active !== false
        }

        const needsPick: {
          order_item_id: string
          product_id: string
          product_name: string
          variant_name: string | null
          options: any[]
        }[] = []
        const resolvedItems: any[] = []
        for (const item of replacementItems) {
          const oiId = item.order_item_id || item.id // return_request_items use order_item_id; legacy order_items use id
          const override = rvMap[oiId]
          let variantId: string | null = item.variant_id || null
          let subVariantId: string | null = item.sub_variant_id || null
          let variantName: string | null = item.variant_name || null

          if (override && (override.variant_id || override.sub_variant_id)) {
            // Admin-picked grain — validate it belongs to this product and is active,
            // and adopt its CURRENT name so the replacement line shows the chosen
            // variant (not the original, now-deleted one).
            variantId = override.variant_id || null
            subVariantId = override.sub_variant_id || null
            const chosen = await queryOne<{ ok: boolean; vname: string | null; svname: string | null }>(
              `SELECT (($2::uuid IS NULL OR pv.id IS NOT NULL) AND ($3::uuid IS NULL OR psv.id IS NOT NULL)) AS ok,
                      pv.variant_name AS vname, psv.sub_variant_name AS svname
                 FROM (SELECT 1) x
                 LEFT JOIN product_variants pv ON pv.id = $2::uuid AND pv.product_id = $1 AND pv.is_active = true
                 LEFT JOIN product_sub_variants psv ON psv.id = $3::uuid AND psv.product_id = $1 AND psv.is_active = true`,
              [item.product_id, variantId, subVariantId]
            )
            if (!chosen?.ok) {
              return NextResponse.json(
                { error: 'Selected replacement variant is invalid or inactive.' },
                { status: 400 }
              )
            }
            variantName = chosen.svname || chosen.vname || variantName
          } else if (
            !(await isActiveVariant(item.variant_id || null)) ||
            !(await isActiveSubVariant(item.sub_variant_id || null))
          ) {
            // Original grain gone/inactive and no override supplied → ask the admin.
            // Attach the product's active grains so the UI can render a picker inline.
            const opts = await queryMany<{
              variant_id: string
              sub_variant_id: string | null
              label: string
              sku: string | null
              stock_status: string | null
            }>(
              `SELECT pv.id AS variant_id, NULL::uuid AS sub_variant_id,
                      pv.variant_name AS label, pv.sku, pv.stock_status
                 FROM product_variants pv
                WHERE pv.product_id = $1 AND pv.is_active = true
                  AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
               UNION ALL
               SELECT pv.id AS variant_id, sv.id AS sub_variant_id,
                      pv.variant_name || ' / ' || sv.sub_variant_name AS label, sv.sku, sv.stock_status
                 FROM product_sub_variants sv
                 JOIN product_variants pv ON pv.id = sv.variant_id
                WHERE sv.product_id = $1 AND sv.is_active = true AND pv.is_active = true
               ORDER BY label`,
              [item.product_id]
            )
            needsPick.push({
              order_item_id: oiId,
              product_id: item.product_id,
              product_name: item.product_name,
              variant_name: item.variant_name || null,
              options: opts,
            })
            continue
          }
          resolvedItems.push({ ...item, _variantId: variantId, _subVariantId: subVariantId, _variantName: variantName })
        }

        if (needsPick.length > 0) {
          return NextResponse.json({ error: 'variant_pick_required', needsVariantPick: needsPick }, { status: 409 })
        }

        let newOrderId: string
        let newOrderNumber: string

        await withTransaction(async client => {
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

          for (const item of resolvedItems) {
            const qty = parseFloat(item.quantity)
            const unitPrice = parseFloat(item.unit_price)
            const variantId: string | null = item._variantId
            const subVariantId: string | null = item._subVariantId
            const variantName: string | null = item._variantName ?? item.variant_name ?? null
            await client.query(
              `INSERT INTO order_items (order_id, product_id, variant_id, sub_variant_id, product_name, variant_name, quantity, unit_price, total_price, buy_mode, buy_unit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                newOrderId,
                item.product_id,
                variantId,
                subVariantId,
                item.product_name,
                variantName,
                qty,
                unitPrice,
                parseFloat((qty * unitPrice).toFixed(2)),
                item.buy_mode || 'unit',
                item.buy_unit || null,
              ]
            )
            // Deduct at the resolved grain (sub-variant → variant → product).
            if (subVariantId) {
              await client.query(
                'UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
                [qty, subVariantId]
              )
            } else if (variantId) {
              await client.query(
                'UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
                [qty, variantId]
              )
            } else {
              await client.query('UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2', [
                qty,
                item.product_id,
              ])
            }
            await logStockMovement(client, {
              productId: item.product_id,
              variantId: variantId,
              subVariantId: subVariantId,
              transactionType: 'sale',
              quantityChange: -qty,
              referenceType: 'order',
              referenceId: newOrderId,
            })
          }

          await client.query(
            `UPDATE return_requests SET status = 'completed', replacement_order_id = $1, reviewed_by = $2, reviewed_at = NOW(), resolved_at = NOW(), updated_at = NOW() WHERE id = $3`,
            [newOrderId, admin.adminId, returnRequest.id]
          )

          await client.query(`UPDATE orders SET status = 'returned', updated_at = NOW() WHERE id = $1`, [orderId])
        })

        if (restock !== false) restoreOrderStock(orderId).catch(() => {})

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
            metadata: {
              return_type: 'replacement',
              status: 'returned',
              replacement_order_id: newOrderId!,
              replacement_order_number: newOrderNumber!,
            },
          }).catch(() => {})
        }

        return NextResponse.json({
          success: true,
          newStatus: 'returned',
          replacementOrderId: newOrderId!,
          replacementOrderNumber: newOrderNumber!,
        })
      }
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to process return review' }, { status: 500 })
  }
}
