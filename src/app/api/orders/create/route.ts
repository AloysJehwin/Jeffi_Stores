import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification } from '@/lib/email'
import { isInterState, calculateGST, round2 } from '@/lib/gst'
import { logActivity } from '@/lib/activity'
import { createAutoTask } from '@/lib/auto-tasks'
import { recordImplicitSignalsForProducts } from '@/lib/ai-feedback'
import { quoteShipping, validateCouponForUser } from '@/lib/order-commit'
import { computeEdd } from '@/lib/edd'
import { getBusinessDiscountMap } from '@/lib/business-discount'
import { createDraftInvoice } from '@/lib/invoice'
import { parseBody, zNonEmpty } from '@/lib/validate'

const CreateOrderSchema = z.object({
  paymentMethod: z.enum(['razorpay', 'manual', 'cod']),
  shippingAddress: z.any().optional(),
  notes: z.string().nullish(),
  couponId: z.string().nullish(),
  // Client-quoted shipping; server re-quotes authoritatively and falls back to
  // this only when the live quote is unavailable (see below).
  shippingAmount: z.number().nonnegative().nullish(),
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
    const clientShipping = parsed.data.shippingAmount ?? null
    const isRazorpayPayment = paymentMethod === 'razorpay'
    const isCod = paymentMethod === 'cod'

    const cartUserId = userId

    const cartItems = await queryMany(`
      SELECT
        ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'sku', p.sku,
          'base_price', p.base_price, 'price_ex_gst', p.price_ex_gst,
          'gst_percentage', p.gst_percentage, 'hsn_code', p.hsn_code,
          'stock_status', p.stock_status, 'inventory_quantity', p.inventory_quantity,
          'is_active', p.is_active,
          'is_cod_allowed', p.is_cod_allowed,
          'category_id', p.category_id, 'discount_pct', p.discount_pct,
          'extra_delivery_days', p.extra_delivery_days,
          'handling_days', p.handling_days
        ) AS products,
        CASE WHEN ci.variant_id IS NOT NULL THEN
          json_build_object(
            'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
            'price', pv.price, 'price_ex_gst', pv.price_ex_gst,
            'stock_status', pv.stock_status, 'inventory_quantity', pv.inventory_quantity,
            'discount_pct', pv.discount_pct
          )
        ELSE NULL END AS variant,
        CASE WHEN ci.sub_variant_id IS NOT NULL THEN
          json_build_object(
            'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
            'price', psv.price, 'price_ex_gst', psv.price_ex_gst,
            'stock_status', psv.stock_status, 'inventory_quantity', psv.inventory_quantity,
            'discount_pct', psv.discount_pct
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

    const inactiveItems = cartItems.filter((item: any) => item.products?.is_active === false)
    if (inactiveItems.length > 0) {
      const names = inactiveItems.map((item: any) => item.products?.name || 'Unknown').join(', ')
      return NextResponse.json({
        error: `Some items in your cart are no longer available: ${names}. Please remove them before placing your order.`,
        inactiveProductIds: inactiveItems.map((item: any) => item.product_id),
      }, { status: 422 })
    }

    if (isCod) {
      const codBlockedItems = cartItems.filter((item: any) => item.products?.is_cod_allowed === false)
      if (codBlockedItems.length > 0) {
        const names = codBlockedItems.map((item: any) => item.products?.name || 'Unknown').join(', ')
        return NextResponse.json({
          error: `COD is not available for: ${names}. Please choose online payment.`,
          codBlockedProductIds: codBlockedItems.map((item: any) => item.product_id),
        }, { status: 422 })
      }
    }

    const subtotal: number = cartItems.reduce((sum: number, item: any) => {
      const pia = parseFloat(item.price_at_addition)
      const price = (pia > 0) ? pia : parseFloat(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
      return sum + (price * parseFloat(item.quantity))
    }, 0)

    const minOrderSetting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
    const minOrderAmount = minOrderSetting ? parseFloat(minOrderSetting.value) || 0 : 0
    if (minOrderAmount > 0 && subtotal < minOrderAmount) {
      return NextResponse.json({ error: `Minimum order value is ₹${minOrderAmount}` }, { status: 400 })
    }

    let businessDiscountAmount = 0
    const bizDiscountMap = await getBusinessDiscountMap(userId)
    if (Object.keys(bizDiscountMap).length > 0) {
      for (const item of cartItems) {
        const catId = (item as any).products?.category_id
        const pct = catId ? (bizDiscountMap[catId] ?? 0) : 0
        if (pct > 0) {
          const _pia = parseFloat(item.price_at_addition)
          const linePrice = (_pia > 0)
            ? _pia
            : parseFloat((item as any).sub_variant?.price ?? (item as any).variant?.price ?? (item as any).products.base_price)
          businessDiscountAmount += linePrice * parseFloat(item.quantity) * pct / 100
        }
      }
      businessDiscountAmount = round2(businessDiscountAmount)
    }

    const taxAmount = cartItems.reduce((sum: number, item: any) => {
      const _pia2 = parseFloat(item.price_at_addition)
      const _p = (_pia2 > 0) ? _pia2 : parseFloat(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
      const lineTotal = _p * parseFloat(item.quantity)
      const gstRate = parseFloat(item.products.gst_percentage || '0')
      return sum + (lineTotal - (lineTotal / (1 + gstRate / 100)))
    }, 0)

    const destinationPin = String(shippingAddress?.postalCode || shippingAddress?.postal_code || '')
    // Server re-quotes with the correct COD flag; fall back to the client-quoted
    // amount when the live quote is unavailable so the charged total matches what
    // the customer saw instead of silently dropping shipping to 0.
    const quotedShipping = destinationPin
      ? await quoteShipping({
          destinationPin,
          items: cartItems.map((c: any) => ({ productId: c.product_id, variantId: c.variant_id, quantity: Number(c.quantity) })),
          subtotal,
          isCod,
        })
      : 0
    const appliedShipping = quotedShipping > 0 ? quotedShipping : (clientShipping != null ? round2(clientShipping) : 0)

    const _eddPin = String(destinationPin || '')
    const _eddHandling = Math.max(2, ...cartItems.map((i: any) => Number(i.products?.handling_days ?? 2)))
    const _eddExtra = Math.max(0, ...cartItems.map((i: any) => Number(i.products?.extra_delivery_days ?? 0)))
    const _edd = computeEdd({ pin: _eddPin, handlingDays: _eddHandling, extraDays: _eddExtra })

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
        const _pia3 = parseFloat(item.price_at_addition)
        const unitPrice = (_pia3 > 0)
          ? _pia3
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

        const itemTax = round2(itemTotal - (itemTotal / (1 + gstRate / 100)))
        return { item, unitPrice, gstRate, itemTotal, itemTax }
      })

      orderTaxableAmount = round2(orderTaxableAmount)
      orderCgst = round2(orderCgst)
      orderSgst = round2(orderSgst)
      orderIgst = round2(orderIgst)

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

      let appliedDiscount = 0
      if (couponId) {
        const couponResult = await validateCouponForUser({ couponId, userId, subtotal })
        if (couponResult.ok) {
          appliedDiscount = couponResult.appliedDiscount
        }
      }
      const txTotal = Math.max(0, subtotal - appliedDiscount - businessDiscountAmount + appliedShipping)

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, status, payment_status, payment_mode, subtotal, discount_amount, business_discount_amount, tax_amount, shipping_amount, total_amount, shipping_address_id, billing_address_id, notes, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst, shipping_address_snapshot, billing_address_snapshot, estimated_delivery_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
         RETURNING *`,
        [orderNumber, userId, user.email, user.phone,
         `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
         'pending', isCod ? 'cod_pending' : 'unpaid', isCod ? 'cod' : (isRazorpayPayment ? 'razorpay' : 'manual'), subtotal, round2(appliedDiscount), round2(businessDiscountAmount), round2(taxAmount), appliedShipping, txTotal, shippingAddressId, billingAddressId,
         notes || null,
         isGSTEnabled ? orderTaxableAmount : 0,
         isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST,
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null),
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null),
         _edd]
      )

      const createdOrder = orderResult.rows[0]

      for (const { item, unitPrice, gstRate, itemTotal, gst, itemTax } of itemsWithGST) {
        const tax = isGSTEnabled && gst ? gst.totalTax : (itemTax || 0)
        const catId = (item as any).products?.category_id
        const bizPct = catId ? (bizDiscountMap[catId] ?? 0) : 0
        const itemBizDiscount = bizPct > 0 ? round2(itemTotal * bizPct / 100) : 0

        // Product-level discount: discount_pct lives on the product and applies to all variants
        const variantDiscPct = Number((item as any).products?.discount_pct ?? 0)
        const mrpUnitPrice = variantDiscPct > 0 ? unitPrice / (1 - variantDiscPct / 100) : unitPrice
        const itemProductDiscount = variantDiscPct > 0 ? round2((mrpUnitPrice - unitPrice) * parseFloat(item.quantity)) : 0

        const totalItemDiscount = round2(itemBizDiscount + itemProductDiscount)
        const itemMrp = item.sub_variant?.mrp != null ? Number(item.sub_variant.mrp)
          : item.variant?.mrp != null ? Number(item.variant.mrp)
          : item.products?.mrp != null ? Number(item.products.mrp)
          : null
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name, quantity, unit_price, total_price, discount_amount, tax_amount, hsn_code, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit, mrp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
          [createdOrder.id, item.product_id, item.variant?.id || null,
           item.sub_variant?.id || null,
           item.sub_variant
             ? `${item.products.name}${item.variant ? ' - ' + item.variant.variant_name : ''} - ${item.sub_variant.sub_variant_name}`
             : (item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name),
           item.sub_variant?.sku || item.variant?.sku || item.products.sku,
           item.sub_variant
             ? `${item.variant?.variant_name ? item.variant.variant_name + ' / ' : ''}${item.sub_variant.sub_variant_name}`
             : (item.variant?.variant_name || null),
           item.quantity, unitPrice, itemTotal, totalItemDiscount, round2(tax),
           isGSTEnabled ? (item.products.hsn_code || null) : null,
           isGSTEnabled ? gstRate : null,
           isGSTEnabled && gst ? gst.taxableAmount : 0,
           isGSTEnabled && gst ? gst.cgst : 0,
           isGSTEnabled && gst ? gst.sgst : 0,
           isGSTEnabled && gst ? gst.igst : 0,
           item.buy_mode || 'unit',
           item.buy_unit || null,
           itemMrp]
        )
      }

      await client.query(
        `DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE`,
        [cartUserId]
      )

      if (couponId && appliedDiscount > 0) {
        await client.query(
          `INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount) VALUES ($1, $2, $3, $4)`,
          [couponId, userId, createdOrder.id, round2(appliedDiscount)]
        )
        await client.query(
          `UPDATE coupons SET times_used = times_used + 1 WHERE id = $1`,
          [couponId]
        )
      }

      return createdOrder
    })

    const orderItems = cartItems.map((item: any) => {
      const _pia4 = parseFloat(item.price_at_addition)
      const unitPrice = (_pia4 > 0)
        ? _pia4
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
      await query(`UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`, [order.id])
      const confirmedOrder = { ...order, status: 'confirmed' }
      createDraftInvoice(order.id).catch(() => {})
      sendOrderConfirmationEmail(user.email, confirmedOrder, orderItems).catch(() => {})
      sendNewOrderNotification(confirmedOrder, orderItems, user).catch(() => {})
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
