import { NextRequest, NextResponse } from 'next/server'
import { productLabel } from '@/lib/product-label'
import { z } from 'zod'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateAnyUser as authenticateUser, authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice, assignInvoiceNumber } from '@/lib/invoice'
import { cancelDelhiveryShipment } from '@/lib/delhivery'
import { logActivity } from '@/lib/activity'
import { deductOrderStock } from '@/lib/inventory-deduct'
import { restoreOrderStock } from '@/lib/order-stock'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { attributeConversion } from '@/lib/marketing'
import { getCurrentTenant } from '@/lib/tenant-context'
import { getFeatureFlags } from '@/lib/site-controls'
import { parseBody } from '@/lib/validate'
import { isPlatformOwner } from '@/lib/scopes'
import { logAdminAudit } from '@/lib/admin-audit'
import {
  notifyOrderConfirmed, notifyOrderShipped, notifyOrderDelivered,
  notifyOrderCancelled, notifyOutForDelivery, notifyPaymentFailed,
} from '@/lib/notify'

const OrderPatchSchema = z.object({
  status: z.string().nullish(),
  payment_status: z.string().nullish(),
  batch_assignments: z.array(z.object({
    order_item_id: z.string().uuid(),
    batch_id: z.string().uuid(),
    qty: z.number().positive(),
  })).nullish(),
  serial_assignments: z.array(z.object({
    order_item_id: z.string().uuid(),
    serial_number: z.string().min(1),
  })).nullish(),
  override: z.boolean().nullish(),
  override_reason: z.string().trim().min(10).max(500).nullish(),
})

const ALL_ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered',
  'cancel_requested', 'cancel_rejected', 'cancelled',
  'return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned',
]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id
    const isBusiness = authUser.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    // Plan gate: Basic plan has no returns module — hide return/replacement UI.
    const { currentTenantPlanGate } = await import('@/lib/plan-gate')
    const returnsEnabled = (await currentTenantPlanGate('returns:read')).allowed

    let order: any
    if (isBusiness) {
      const bizUser = await queryOne<{ email: string; phone: string | null }>(
        'SELECT email, phone FROM users WHERE id = $1',
        [authUser.userId]
      )
      const email = bizUser?.email || ''
      const phone = bizUser?.phone || null
      order = await queryOne(`
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
        WHERE o.id = $1 AND o.status != 'draft' AND (
          o.user_id = $2 OR
          (o.source = 'business' AND (o.customer_email = $3 OR ($4::text IS NOT NULL AND o.customer_phone = $4)))
        )
      `, [orderId, authUser.userId, email, phone])
    } else {
      order = await queryOne(`
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
        WHERE o.id = $1 AND o.status != 'draft' AND o.user_id = $2
      `, [orderId, authUser.userId])
    }

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const orderItems = await queryMany(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.product_sku, oi.variant_name, oi.quantity, oi.unit_price, oi.total_price, oi.buy_mode, oi.buy_unit,
        psv.sub_variant_name, psv.sku AS sub_variant_sku,
        json_build_object('slug', p.slug, 'extra_delivery_days', p.extra_delivery_days,
          'fragile', p.fragile, 'hazardous', p.hazardous, 'flammable', p.flammable,
          'product_images',
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

    // Pending variant-change request (admin-proposed swap awaiting this customer).
    const pendingVcr = await queryOne<any>(
      `SELECT vcr.id, vcr.order_item_id, vcr.old_unit_price, vcr.new_unit_price, vcr.qty,
              vcr.price_diff, vcr.settlement_type, vcr.status,
              oi.product_name, vcr.old_variant_name, vcr.new_variant_name
       FROM variant_change_requests vcr
       JOIN order_items oi ON oi.id = vcr.order_item_id
       WHERE vcr.order_id = $1 AND vcr.status IN ('pending_customer','awaiting_payment')
       ORDER BY vcr.created_at DESC LIMIT 1`,
      [orderId]
    )

    const orderDetails = {
      id: order.id,
      orderNumber: order.order_number,
      invoiceNumber: order.invoice_number || null,
      viewToken: order.view_token || null,
      totalAmount: parseFloat(order.total_amount),
      subtotal: parseFloat(order.subtotal || order.total_amount),
      taxAmount: parseFloat(order.tax_amount || '0'),
      discountAmount: parseFloat(order.discount_amount || '0'),
      businessDiscountAmount: parseFloat(order.business_discount_amount || '0'),
      shippingAmount: parseFloat(order.shipping_amount || '0'),
      codFeeAmount: parseFloat(order.cod_fee_amount || '0'),
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMode: order.payment_mode || null,
      razorpayQrImageUrl: order.razorpay_qr_image_url || null,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      deliveredAt: order.delivered_at || null,
      notes: order.notes,
      trackingUrl: order.tracking_url || null,
      awbNumber: order.awb_number || null,
      estimatedDeliveryDate: order.estimated_delivery_date
        ? (order.estimated_delivery_date instanceof Date
            ? order.estimated_delivery_date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
            : String(order.estimated_delivery_date).slice(0, 10))
        : null,
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
        // Returns/replacements are only available on Growth plan and above.
        // Basic plan tenants don't have the returns module — force false so the
        // UI never shows Return/Replace buttons regardless of product settings.
        returnAllowed: returnsEnabled ? (item.return_allowed === false ? false : !!item.return_allowed) : false,
        returnWindowDays: parseInt(item.return_window_days) || 7,
        replacementAllowed: returnsEnabled ? (item.replacement_allowed === false ? false : !!item.replacement_allowed) : false,
        replacementWindowDays: parseInt(item.replacement_window_days) || 7,
      })),
      pendingVariantChange: pendingVcr ? {
        id: pendingVcr.id,
        productName: pendingVcr.product_name,
        oldVariantName: pendingVcr.old_variant_name,
        newVariantName: pendingVcr.new_variant_name,
        oldUnitPrice: parseFloat(pendingVcr.old_unit_price),
        newUnitPrice: parseFloat(pendingVcr.new_unit_price),
        qty: parseFloat(pendingVcr.qty),
        priceDiff: parseFloat(pendingVcr.price_diff),
        settlementType: pendingVcr.settlement_type,
        status: pendingVcr.status,
      } : null,
    }

    return NextResponse.json({ order: orderDetails })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id
    const body = await request.json()
    const parsed = parseBody(OrderPatchSchema, body)
    if (!parsed.ok) return parsed.response
    const { status, payment_status, batch_assignments, serial_assignments } = parsed.data
    const wantsOverride = parsed.data.override === true
    const overrideReason = parsed.data.override_reason?.trim() || ''

    if (wantsOverride) {
      if (!isPlatformOwner(admin.role)) {
        return NextResponse.json({ error: 'Only a super admin can override the order status' }, { status: 403 })
      }
      if (!overrideReason) {
        return NextResponse.json({ error: 'override_reason is required when overriding (10-500 characters)' }, { status: 400 })
      }
      if (status && !ALL_ORDER_STATUSES.includes(status)) {
        return NextResponse.json({ error: `Unknown order status: ${status}` }, { status: 400 })
      }
    }

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

    if (!wantsOverride && TERMINAL_STATUSES.includes(currentOrder.status)) {
      return NextResponse.json({ error: `Orders with status '${currentOrder.status}' cannot be modified` }, { status: 400 })
    }

    const validPaymentStatuses = ['pending', 'unpaid', 'paid', 'failed', 'refunded', 'cod_pending', 'cod_collected']

    if (!wantsOverride && status && status !== currentOrder.status) {
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

    if (!wantsOverride && currentOrder.payment_status === 'paid' && payment_status === 'pending') {
      return NextResponse.json({ error: 'Paid orders cannot revert to pending. Use refunded instead.' }, { status: 400 })
    }

    const statusChanged = status && status !== currentOrder.status
    const paymentStatusChanged = payment_status && payment_status !== currentOrder.payment_status

    // Basic-plan tenants have no inventory module (flag locked off). When off, skip
    // ALL stock validation/deduction/restore so a conversion is never blocked by
    // stock they can't manage — matching the order-create bypass.
    const { inventoryValidationEnabled } = await getFeatureFlags()

    if (statusChanged && status === 'processing' && inventoryValidationEnabled) {
      const items = await queryMany<any>(
        `SELECT oi.product_id, oi.variant_id, oi.sub_variant_id, oi.quantity, oi.buy_unit, oi.product_name, oi.variant_name,
          CASE
            WHEN oi.sub_variant_id IS NOT NULL THEN (SELECT inventory_quantity FROM product_sub_variants WHERE id = oi.sub_variant_id)
            WHEN oi.variant_id IS NOT NULL THEN (SELECT inventory_quantity FROM product_variants WHERE id = oi.variant_id)
            ELSE (SELECT inventory_quantity FROM products WHERE id = oi.product_id)
          END AS inventory_quantity
         FROM order_items oi WHERE oi.order_id = $1`,
        [orderId]
      )
      const insufficient: string[] = []
      for (const item of items) {
        const rawQty = parseFloat(item.quantity)
        const unitRow = await queryOne<{ factor: string; dimension: string }>(
          `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                  COALESCE(puv.dimension, pup.dimension) AS dimension
           FROM (SELECT 1) x
           LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
           LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
          [item.buy_unit, item.product_id, item.variant_id || null]
        )
        const baseQty = (unitRow?.dimension === 'count' && unitRow?.factor)
          ? rawQty * parseFloat(unitRow.factor)
          : rawQty
        const stock = Number(item.inventory_quantity) || 0
        if (stock < baseQty) {
          insufficient.push(
            `${productLabel(item)} (available: ${stock}, required: ${baseQty})`
          )
        }
      }
      if (insufficient.length > 0) {
        return NextResponse.json(
          { error: `Insufficient stock for: ${insufficient.join('; ')}. Update inventory before marking as processing.` },
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

    // An override skips the transition rules, so it must leave a trail that says who did it
    // and why — otherwise the order history shows a jump no state machine could produce.
    if (wantsOverride) {
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      if (status && status !== currentOrder.status) diff.status = { from: currentOrder.status, to: status }
      if (payment_status && payment_status !== currentOrder.payment_status) {
        diff.payment_status = { from: currentOrder.payment_status, to: payment_status }
      }
      await logAdminAudit({
        adminId: admin.adminId,
        action: 'update',
        entityType: 'order',
        entityId: orderId,
        summary: `Status override on ${currentOrder.order_number}: ${Object.entries(diff).map(([k, v]) => `${k} ${v.from} → ${v.to}`).join(', ') || 'no field change'}`,
        diff,
        metadata: { override: true, reason: overrideReason, role: admin.role },
        request,
      }).catch(() => {})
    }

    // On cancellation, restore inventory if — and only if — stock was actually
    // deducted (i.e. the order reached 'processing' and has a 'sale' ledger row).
    // restoreOrderStock resets serials to in_stock, reverses batches, and syncs
    // shelf/central qty; it is idempotent (guards on an existing 'return' row).
    // Orders cancelled before processing never deducted, so this is a no-op.
    if (statusChanged && status === 'cancelled' && inventoryValidationEnabled) {
      const sale = await queryOne(
        `SELECT 1 FROM inventory_transactions WHERE reference_type = 'order' AND reference_id = $1 AND transaction_type = 'sale' LIMIT 1`,
        [orderId]
      )
      if (sale) await restoreOrderStock(orderId)
    }

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

        // NOTE: cancelling a paid order does NOT auto-refund here. Refunding is a
        // separate, explicit admin step — the "Refund Pending" card (rendered when
        // status='cancelled' && payment_status='paid') calls /api/orders/[id]/refund,
        // which refunds ALL completed payments (initial charge + any variant-change
        // top-ups), not just the first. We therefore leave payment_status untouched
        // (stays 'paid') on cancel so that card surfaces and the admin refunds
        // deliberately. Removing the old auto-refund also fixes the bug where the UI
        // pre-set payment_status='refunded', the auto-refund guard skipped, and the
        // order showed "Refunded" with no money actually returned.

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
      // Deduct inventory via the shared helper — the single source of truth for
      // plain / perishable (FEFO) / serialized deduction. It writes ONE ledger
      // row per serial (quantityChange -1), decrements batches per serial, and
      // recomputes central inventory via syncPerishableStock (so serialized/
      // perishable items are NOT double-deducted). Admin batch/serial picker
      // selections are respected; requireSerialAssignments preserves the picker
      // contract for serialized items. Idempotent on re-transition.
      await withTransaction(async (client) => {
        // Skip deduction on Basic (flag off) — no inventory module, nothing to deduct.
        if (inventoryValidationEnabled) {
          await deductOrderStock(
            orderId,
            {
              batchAssignments: batch_assignments ?? undefined,
              serialAssignments: serial_assignments ?? undefined,
              requireSerialAssignments: true,
            },
            client
          )
        }
        // Assign the invoice number/document at processing for ALL orders,
        // including COD (never payment_status='paid' until remittance). The PDF is
        // still rendered later by generateOrderInvoice once the order is paid.
        await assignInvoiceNumber(client, orderId)
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
          // SMS / WhatsApp per customer preference — covers all status transitions
          const uid = currentOrder.user_id
          const on = currentOrder.order_number
          if (status === 'confirmed' || status === 'processing') {
            notifyOrderConfirmed(uid, on, parseFloat(currentOrder.total_amount)).catch(() => {})
          } else if (status === 'shipped') {
            const awb = await queryOne<{ awb_number: string | null }>('SELECT awb_number FROM orders WHERE id = $1', [orderId])
            notifyOrderShipped(uid, on, 'Delhivery', awb?.awb_number || null).catch(() => {})
          } else if (status === 'out_for_delivery') {
            notifyOutForDelivery(uid, on).catch(() => {})
          } else if (status === 'delivered') {
            notifyOrderDelivered(uid, on).catch(() => {})
          } else if (status === 'cancelled') {
            notifyOrderCancelled(uid, on).catch(() => {})
          }
        }
        if (paymentStatusChanged) {
          await sendPaymentStatusUpdate(
            userEmail, userName, currentOrder.order_number, orderId,
            payment_status, parseFloat(currentOrder.total_amount)
          ).catch(() => {})
          if (payment_status === 'failed') {
            notifyPaymentFailed(currentOrder.user_id, currentOrder.order_number).catch(() => {})
          }
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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
      [id, authUser.userId]
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
      [id]
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

    await query('DELETE FROM orders WHERE id = $1 AND user_id = $2', [id, authUser.userId])

    return NextResponse.json({ success: true, deleted: true })
  } catch (err) {
return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 })
  }
}
