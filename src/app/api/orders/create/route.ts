import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification } from '@/lib/email'
import { isInterState, calculateGST } from '@/lib/gst'
import { logActivity } from '@/lib/activity'
import { createAutoTask } from '@/lib/auto-tasks'
import { recordImplicitSignalsForProducts } from '@/lib/ai-feedback'
import { quoteShipping } from '@/lib/order-commit'
import { createDraftInvoice } from '@/lib/invoice'
import { parseBody, zNonEmpty } from '@/lib/validate'

const CreateOrderSchema = z.object({
  paymentMethod: z.enum(['razorpay', 'manual']),
  shippingAddress: z.any().optional(),
  notes: z.string().nullish(),
  couponId: z.string().nullish(),
})

const isGSTEnabled = process.env.ENABLE_GST === 'true'

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authUser.userId

    const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId])

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = parseBody(CreateOrderSchema, body)
    if (!parsed.ok) return parsed.response
    const { shippingAddress, notes, paymentMethod, couponId } = parsed.data
    const isRazorpayPayment = paymentMethod === 'razorpay'
    const isCod = false

    const cartUserId = userId

    const cartItems = await queryMany(`
      SELECT
        ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'sku', p.sku,
          'base_price', p.base_price, 'price_ex_gst', p.price_ex_gst,
          'gst_percentage', p.gst_percentage, 'hsn_code', p.hsn_code,
          'stock_status', p.stock_status, 'inventory_quantity', p.inventory_quantity
        ) AS products,
        CASE WHEN ci.variant_id IS NOT NULL THEN
          json_build_object(
            'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
            'price', pv.price, 'price_ex_gst', pv.price_ex_gst,
            'stock_status', pv.stock_status, 'inventory_quantity', pv.inventory_quantity
          )
        ELSE NULL END AS variant,
        CASE WHEN ci.sub_variant_id IS NOT NULL THEN
          json_build_object(
            'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
            'price', psv.price, 'price_ex_gst', psv.price_ex_gst,
            'stock_status', psv.stock_status, 'inventory_quantity', psv.inventory_quantity
          )
        ELSE NULL END AS sub_variant
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      LEFT JOIN product_sub_variants psv ON ci.sub_variant_id = psv.id
      WHERE ci.user_id = $1
    `, [cartUserId])

    if (!cartItems || cartItems.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    const subtotal: number = cartItems.reduce((sum: number, item: any) => {
      if (item.buy_mode === 'weight' || item.buy_mode === 'length') {
        return sum + (parseFloat(item.price_at_addition) * parseFloat(item.quantity))
      }
      const price = item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price
      return sum + (parseFloat(price) * parseFloat(item.quantity))
    }, 0)

    const minOrderSetting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
    const minOrderAmount = minOrderSetting ? parseFloat(minOrderSetting.value) || 0 : 0
    if (minOrderAmount > 0 && subtotal < minOrderAmount) {
      return NextResponse.json({ error: `Minimum order value is ₹${minOrderAmount}` }, { status: 400 })
    }

    const taxAmount = cartItems.reduce((sum: number, item: any) => {
      const lineTotal = item.buy_mode === 'weight' || item.buy_mode === 'length'
        ? parseFloat(item.price_at_addition) * parseFloat(item.quantity)
        : parseFloat(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price) * parseFloat(item.quantity)
      const gstRate = parseFloat(item.products.gst_percentage || '0')
      return sum + (lineTotal - (lineTotal / (1 + gstRate / 100)))
    }, 0)

    let appliedDiscount = 0
    if (couponId) {
      const coupon = await queryOne<{
        id: string; discount_type: string; discount_value: number;
        min_purchase_amount: number | null; max_discount_amount: number | null;
        usage_limit: number | null; usage_limit_per_user: number | null;
        times_used: number; valid_from: string | null; valid_until: string | null; is_active: boolean
      }>(`SELECT * FROM coupons WHERE id = $1`, [couponId])

      if (coupon && coupon.is_active) {
        const now = new Date()
        const validFrom = coupon.valid_from ? new Date(coupon.valid_from) : null
        const validUntil = coupon.valid_until ? new Date(coupon.valid_until) : null
        const withinWindow = (!validFrom || validFrom <= now) && (!validUntil || validUntil >= now)
        const underGlobalLimit = coupon.usage_limit === null || coupon.times_used < coupon.usage_limit

        let underPerUserLimit = true
        if (coupon.usage_limit_per_user !== null) {
          const usage = await queryOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = $1 AND user_id = $2`,
            [coupon.id, userId]
          )
          underPerUserLimit = !usage || parseInt(usage.cnt) < coupon.usage_limit_per_user
        }

        const meetsMinPurchase = coupon.min_purchase_amount === null || subtotal >= coupon.min_purchase_amount

        if (withinWindow && underGlobalLimit && underPerUserLimit && meetsMinPurchase) {
          if (coupon.discount_type === 'percentage') {
            appliedDiscount = (subtotal * Number(coupon.discount_value)) / 100
            if (coupon.max_discount_amount !== null) {
              appliedDiscount = Math.min(appliedDiscount, Number(coupon.max_discount_amount))
            }
          } else {
            appliedDiscount = Number(coupon.discount_value)
          }
          appliedDiscount = Math.min(appliedDiscount, subtotal)
          appliedDiscount = Math.round(appliedDiscount * 100) / 100
        }
      }
    }

    const destinationPin = String(shippingAddress?.postalCode || shippingAddress?.postal_code || '')
    const appliedShipping = destinationPin
      ? await quoteShipping({
          destinationPin,
          items: cartItems.map((c: any) => ({ productId: c.product_id, variantId: c.variant_id, quantity: Number(c.quantity) })),
          subtotal,
          isCod,
        })
      : 0

    const total = subtotal - appliedDiscount + appliedShipping

    const order = await withTransaction(async (client) => {
      let shippingAddressId = null
      let billingAddressId = null
      let shippingAddressSnapshot = null

      if (shippingAddress) {
        const fullName = shippingAddress.fullName || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
        const phone = shippingAddress.phone || user.phone || '0000000000'

        const existingAddress = await client.query(
          `SELECT * FROM addresses
           WHERE user_id = $1 AND address_line1 = $2 AND city = $3 AND postal_code = $4
           LIMIT 1`,
          [userId, shippingAddress.addressLine1, shippingAddress.city, shippingAddress.postalCode]
        )

        if (existingAddress.rows[0]) {
          shippingAddressId = existingAddress.rows[0].id
          billingAddressId = existingAddress.rows[0].id
          shippingAddressSnapshot = existingAddress.rows[0]
        } else {
          const addressResult = await client.query(
            `INSERT INTO addresses (user_id, address_type, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [userId, 'both', fullName, phone, shippingAddress.addressLine1,
             shippingAddress.addressLine2 || null, shippingAddress.landmark || null,
             shippingAddress.city, shippingAddress.state, shippingAddress.postalCode,
             shippingAddress.country || 'India', false]
          )

          if (addressResult.rows[0]) {
            shippingAddressId = addressResult.rows[0].id
            billingAddressId = addressResult.rows[0].id
            shippingAddressSnapshot = addressResult.rows[0]
          }
        }
      }

      let orderTaxableAmount = 0
      let orderCgst = 0
      let orderSgst = 0
      let orderIgst = 0
      let isIGST = false

      if (isGSTEnabled) {
        const sellerStateCode = process.env.BUSINESS_STATE_CODE || '22'
        const buyerState = shippingAddress?.state || ''
        isIGST = isInterState(buyerState, sellerStateCode)
      }

      const itemsWithGST = cartItems.map((item: any) => {
        const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
        const unitPrice = isCustomQty
          ? parseFloat(item.price_at_addition)
          : parseFloat(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
        const qty = parseFloat(item.quantity)
        const gstRate = parseFloat(item.products.gst_percentage || '0')
        const itemTotal = unitPrice * qty

        if (isGSTEnabled) {
          const gst = calculateGST(itemTotal, gstRate, isIGST)
          orderTaxableAmount += gst.taxableAmount
          orderCgst += gst.cgst
          orderSgst += gst.sgst
          orderIgst += gst.igst
          return { item, unitPrice, gstRate, itemTotal, gst }
        }

        const itemTax = Math.round((itemTotal - (itemTotal / (1 + gstRate / 100))) * 100) / 100
        return { item, unitPrice, gstRate, itemTotal, itemTax }
      })

      orderTaxableAmount = Math.round(orderTaxableAmount * 100) / 100
      orderCgst = Math.round(orderCgst * 100) / 100
      orderSgst = Math.round(orderSgst * 100) / 100
      orderIgst = Math.round(orderIgst * 100) / 100

      let addrSnapshot: object | null = null
      if (shippingAddressId) {
        const addrRow = await client.query(
          'SELECT full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country FROM addresses WHERE id = $1',
          [shippingAddressId]
        )
        addrSnapshot = addrRow.rows[0] || null
      }

      const existingUnpaidResult = await client.query(
        `SELECT o.id, o.order_number FROM orders o
         INNER JOIN payments p ON p.order_id = o.id AND p.payment_gateway = 'razorpay'
         WHERE o.user_id = $1 AND o.payment_status = 'unpaid' AND o.status = 'pending'
         ORDER BY o.created_at DESC LIMIT 1
         FOR UPDATE`,
        [userId]
      )
      if (existingUnpaidResult.rows[0]) {
        const existing = existingUnpaidResult.rows[0]
        throw Object.assign(new Error('EXISTING_UNPAID_ORDER'), { existingOrderId: existing.id, existingOrderNumber: existing.order_number })
      }

      const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, status, payment_status, subtotal, discount_amount, tax_amount, shipping_amount, total_amount, shipping_address_id, billing_address_id, notes, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst, shipping_address_snapshot, billing_address_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING *`,
        [orderNumber, userId, user.email, user.phone,
         `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
         'pending', 'unpaid', subtotal, Math.round(appliedDiscount * 100) / 100, Math.round(taxAmount * 100) / 100, appliedShipping, Math.max(0, total), shippingAddressId, billingAddressId,
         notes || null,
         isGSTEnabled ? orderTaxableAmount : 0,
         isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST,
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null),
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null)]
      )

      const createdOrder = orderResult.rows[0]

      for (const { item, unitPrice, gstRate, itemTotal, gst, itemTax } of itemsWithGST) {
        const tax = isGSTEnabled && gst ? gst.totalTax : (itemTax || 0)
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name, quantity, unit_price, total_price, tax_amount, hsn_code, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [createdOrder.id, item.product_id, item.variant?.id || null,
           item.sub_variant?.id || null,
           item.sub_variant
             ? `${item.products.name}${item.variant ? ' - ' + item.variant.variant_name : ''} - ${item.sub_variant.sub_variant_name}`
             : (item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name),
           item.sub_variant?.sku || item.variant?.sku || item.products.sku,
           item.sub_variant
             ? `${item.variant?.variant_name ? item.variant.variant_name + ' / ' : ''}${item.sub_variant.sub_variant_name}`
             : (item.variant?.variant_name || null),
           item.quantity, unitPrice, itemTotal, Math.round(tax * 100) / 100,
           isGSTEnabled ? (item.products.hsn_code || null) : null,
           isGSTEnabled ? gstRate : null,
           isGSTEnabled && gst ? gst.taxableAmount : 0,
           isGSTEnabled && gst ? gst.cgst : 0,
           isGSTEnabled && gst ? gst.sgst : 0,
           isGSTEnabled && gst ? gst.igst : 0,
           item.buy_mode || 'unit',
           item.buy_unit || null]
        )
      }

      await client.query(
        `DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE`,
        [cartUserId]
      )

      if (couponId && appliedDiscount > 0) {
        await client.query(
          `INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount) VALUES ($1, $2, $3, $4)`,
          [couponId, userId, createdOrder.id, Math.round(appliedDiscount * 100) / 100]
        )
        await client.query(
          `UPDATE coupons SET times_used = times_used + 1 WHERE id = $1`,
          [couponId]
        )
      }

      return createdOrder
    })

    const orderItems = cartItems.map((item: any) => {
      const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
      const unitPrice = isCustomQty
        ? parseFloat(item.price_at_addition)
        : parseFloat(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
      return {
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.sub_variant
          ? `${item.products.name}${item.variant ? ' - ' + item.variant.variant_name : ''} - ${item.sub_variant.sub_variant_name}`
          : (item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name),
        product_sku: item.sub_variant?.sku || item.variant?.sku || item.products.sku,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: unitPrice * parseFloat(item.quantity),
        buy_mode: item.buy_mode || 'unit',
        buy_unit: item.buy_unit || null,
      }
    })

    if (!isRazorpayPayment) {
      createDraftInvoice(order.id).catch(() => {})
      sendOrderConfirmationEmail(user.email, order, orderItems).catch(() => {})
      sendNewOrderNotification(order, orderItems, user).catch(() => {})
    }

    logActivity({
      userId,
      kind: 'order_placed',
      referenceId: order.id,
      referenceType: 'orders',
      summary: `Placed order #${order.order_number} — ₹${Number(order.total_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      metadata: { orderNumber: order.order_number, total: order.total_amount, itemCount: orderItems.length },
    }).catch(() => {})

    recordImplicitSignalsForProducts(userId, orderItems.map(i => i.product_id), 'purchased').catch(() => {})

    if (Number(order.total_amount) >= 50000) {
      createAutoTask({
        userId,
        sourceKind: 'review_high_value_order',
        sourceRefId: order.id,
        title: `Review high-value order #${order.order_number} (₹${Number(order.total_amount).toLocaleString('en-IN')})`,
        description: 'Large order — verify stock, address, and payment before fulfilling.',
        priority: 'high',
        dueInDays: 0,
      }).catch(() => {})
    }

    return NextResponse.json({
      message: 'Order created successfully',
      order: {
        id: order.id,
        orderNumber: order.order_number,
        total: order.total_amount,
        status: order.status,
      },
      requiresPayment: isRazorpayPayment,
    })
  } catch (err: any) {
    if (err?.message === 'EXISTING_UNPAID_ORDER') {
      return NextResponse.json({
        error: 'You have an unpaid order. Please complete or cancel it before placing a new one.',
        existingOrderId: err.existingOrderId,
        existingOrderNumber: err.existingOrderNumber,
      }, { status: 409 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
