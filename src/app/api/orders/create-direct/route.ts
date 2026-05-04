import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, withTransaction } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification } from '@/lib/email'
import { isInterState, calculateGST } from '@/lib/gst'

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
    const { shippingAddress, notes, paymentMethod, couponId, discountAmount: rawDiscount, shippingAmount: rawShipping, item } = body
    const isRazorpayPayment = paymentMethod === 'razorpay'
    const appliedDiscount = typeof rawDiscount === 'number' && rawDiscount > 0 ? rawDiscount : 0
    const appliedShipping = typeof rawShipping === 'number' && rawShipping > 0 ? Math.round(rawShipping * 100) / 100 : 0

    if (!item || !item.productId || !item.qty || !item.price) {
      return NextResponse.json({ error: 'Item details are required' }, { status: 400 })
    }

    const existingUnpaidOrder = await queryOne(
      `SELECT o.id, o.order_number FROM orders o
       INNER JOIN payments p ON p.order_id = o.id AND p.payment_gateway = 'razorpay'
       WHERE o.user_id = $1 AND o.payment_status = 'unpaid' AND o.status = 'pending'
       ORDER BY o.created_at DESC LIMIT 1`,
      [userId]
    )

    if (existingUnpaidOrder) {
      return NextResponse.json({
        error: 'You have an unpaid order. Please complete or cancel it before placing a new one.',
        existingOrderId: existingUnpaidOrder.id,
        existingOrderNumber: existingUnpaidOrder.order_number,
      }, { status: 409 })
    }

    const product = await queryOne<any>(
      `SELECT p.*, p.gst_percentage, p.hsn_code FROM products p WHERE p.id = $1`,
      [item.productId]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const variant = item.variantId
      ? await queryOne<any>('SELECT * FROM product_variants WHERE id = $1', [item.variantId])
      : null

    if (item.buyMode === 'unit' || !item.buyMode) {
      const stockQty = variant ? variant.stock_quantity : product.stock_quantity
      if (stockQty < item.qty) {
        return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })
      }
    }

    const unitPrice = parseFloat(item.price)
    const qty = parseFloat(item.qty)
    const itemTotal = unitPrice * qty
    const subtotal = itemTotal
    const gstRate = parseFloat(product.gst_percentage || '0')

    let taxAmount = 0
    let orderTaxableAmount = 0
    let orderCgst = 0
    let orderSgst = 0
    let orderIgst = 0
    let isIGST = false

    if (isGSTEnabled) {
      const sellerStateCode = process.env.BUSINESS_STATE_CODE || '22'
      const buyerState = shippingAddress?.state || ''
      isIGST = isInterState(buyerState, sellerStateCode)
      const gst = calculateGST(itemTotal, gstRate, isIGST)
      taxAmount = gst.totalTax
      orderTaxableAmount = Math.round(gst.taxableAmount * 100) / 100
      orderCgst = Math.round(gst.cgst * 100) / 100
      orderSgst = Math.round(gst.sgst * 100) / 100
      orderIgst = Math.round(gst.igst * 100) / 100
    } else {
      taxAmount = Math.round((itemTotal - (itemTotal / (1 + gstRate / 100))) * 100) / 100
    }

    const total = Math.max(0, subtotal - appliedDiscount + appliedShipping)
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const order = await withTransaction(async (client) => {
      let shippingAddressId = null
      let billingAddressId = null

      if (shippingAddress) {
        const fullName = shippingAddress.fullName || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
        const phone = shippingAddress.phone || user.phone || '0000000000'

        const existingAddress = await client.query(
          `SELECT id FROM addresses WHERE user_id = $1 AND address_line1 = $2 AND city = $3 AND postal_code = $4 LIMIT 1`,
          [userId, shippingAddress.addressLine1, shippingAddress.city, shippingAddress.postalCode]
        )

        if (existingAddress.rows[0]) {
          shippingAddressId = existingAddress.rows[0].id
          billingAddressId = existingAddress.rows[0].id
        } else {
          const addressResult = await client.query(
            `INSERT INTO addresses (user_id, address_type, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [userId, 'both', fullName, phone, shippingAddress.addressLine1,
             shippingAddress.addressLine2 || null, shippingAddress.landmark || null,
             shippingAddress.city, shippingAddress.state, shippingAddress.postalCode,
             shippingAddress.country || 'India', false]
          )
          if (addressResult.rows[0]) {
            shippingAddressId = addressResult.rows[0].id
            billingAddressId = addressResult.rows[0].id
          }
        }
      }

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, status, payment_status, subtotal, discount_amount, tax_amount, shipping_amount, total_amount, shipping_address_id, billing_address_id, notes, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING *`,
        [orderNumber, userId, user.email, user.phone,
         `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
         'pending', 'unpaid', subtotal, Math.round(appliedDiscount * 100) / 100, Math.round(taxAmount * 100) / 100, appliedShipping, total,
         shippingAddressId, billingAddressId, notes || null,
         isGSTEnabled ? orderTaxableAmount : 0,
         isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST]
      )

      const createdOrder = orderResult.rows[0]

      let gstForItem = null
      if (isGSTEnabled) {
        gstForItem = calculateGST(itemTotal, gstRate, isIGST)
      }
      const itemTaxAmount = isGSTEnabled && gstForItem ? gstForItem.totalTax : taxAmount

      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, variant_name, quantity, unit_price, total_price, tax_amount, hsn_code, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [createdOrder.id, item.productId, item.variantId || null,
         variant ? `${product.name} - ${variant.variant_name}` : product.name,
         variant?.sku || product.sku,
         variant?.variant_name || null,
         qty, unitPrice, itemTotal, Math.round(itemTaxAmount * 100) / 100,
         isGSTEnabled ? (product.hsn_code || null) : null,
         isGSTEnabled ? gstRate : null,
         isGSTEnabled && gstForItem ? gstForItem.taxableAmount : 0,
         isGSTEnabled && gstForItem ? gstForItem.cgst : 0,
         isGSTEnabled && gstForItem ? gstForItem.sgst : 0,
         isGSTEnabled && gstForItem ? gstForItem.igst : 0,
         item.buyMode || 'unit',
         item.buyUnit || null]
      )

      if (item.buyMode === 'unit' || !item.buyMode) {
        if (variant) {
          await client.query(
            'UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [qty, variant.id]
          )
        } else {
          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [qty, item.productId]
          )
        }
      }

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

    const orderItems = [{
      order_id: order.id,
      product_id: item.productId,
      product_name: variant ? `${product.name} - ${variant.variant_name}` : product.name,
      product_sku: variant?.sku || product.sku,
      quantity: qty,
      unit_price: unitPrice,
      total_price: itemTotal,
      buy_mode: item.buyMode || 'unit',
      buy_unit: item.buyUnit || null,
    }]

    if (!isRazorpayPayment) {
      sendOrderConfirmationEmail(user.email, order, orderItems, null).catch(() => {})
      sendNewOrderNotification(order, orderItems, user).catch(() => {})
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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
