import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
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
    const { shippingAddress, notes, paymentMethod } = body
    const isRazorpayPayment = paymentMethod === 'razorpay'

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

    const cartUserId = userId

    const cartItems = await queryMany(`
      SELECT
        ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'sku', p.sku,
          'base_price', p.base_price, 'sale_price', p.sale_price,
          'gst_percentage', p.gst_percentage, 'hsn_code', p.hsn_code,
          'stock_quantity', p.stock_quantity, 'is_in_stock', p.is_in_stock
        ) AS products,
        CASE WHEN ci.variant_id IS NOT NULL THEN
          json_build_object(
            'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
            'price', pv.price, 'sale_price', pv.sale_price,
            'stock_quantity', pv.stock_quantity
          )
        ELSE NULL END AS variant
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.user_id = $1
    `, [cartUserId])

    if (!cartItems || cartItems.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    for (const item of cartItems) {
      const stockQty = item.variant ? item.variant.stock_quantity : item.products.stock_quantity
      const itemName = item.variant
        ? `${item.products.name} (${item.variant.variant_name})`
        : item.products.name
      if ((item.buy_mode === 'unit' || !item.buy_mode) && stockQty < item.quantity) {
        return NextResponse.json(
          { error: `${itemName} is out of stock or has insufficient quantity` },
          { status: 400 }
        )
      }
    }

    const subtotal = cartItems.reduce((sum: number, item: any) => {
      if (item.buy_mode === 'weight' || item.buy_mode === 'length') {
        return sum + (parseFloat(item.price_at_addition) * parseFloat(item.quantity))
      }
      const price = item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price
      return sum + (parseFloat(price) * parseFloat(item.quantity))
    }, 0)

    const taxAmount = cartItems.reduce((sum: number, item: any) => {
      const lineTotal = item.buy_mode === 'weight' || item.buy_mode === 'length'
        ? parseFloat(item.price_at_addition) * parseFloat(item.quantity)
        : parseFloat(item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price) * parseFloat(item.quantity)
      const gstRate = parseFloat(item.products.gst_percentage || '0')
      return sum + (lineTotal - (lineTotal / (1 + gstRate / 100)))
    }, 0)

    const total = subtotal

    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const order = await withTransaction(async (client) => {
      let shippingAddressId = null
      let billingAddressId = null

      if (shippingAddress) {
        const fullName = shippingAddress.fullName || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
        const phone = shippingAddress.phone || user.phone || '0000000000'

        const existingAddress = await client.query(
          `SELECT id FROM addresses
           WHERE user_id = $1 AND address_line1 = $2 AND city = $3 AND postal_code = $4
           LIMIT 1`,
          [userId, shippingAddress.addressLine1, shippingAddress.city, shippingAddress.postalCode]
        )

        if (existingAddress.rows[0]) {
          shippingAddressId = existingAddress.rows[0].id
          billingAddressId = existingAddress.rows[0].id
        } else {
          const addressResult = await client.query(
            `INSERT INTO addresses (user_id, address_type, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
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
          : parseFloat(item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
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

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, status, payment_status, subtotal, tax_amount, total_amount, shipping_address_id, billing_address_id, notes, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [orderNumber, userId, user.email, user.phone,
         `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
         'pending', 'unpaid', subtotal, Math.round(taxAmount * 100) / 100, total, shippingAddressId, billingAddressId, notes || null,
         isGSTEnabled ? orderTaxableAmount : 0,
         isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST]
      )

      const createdOrder = orderResult.rows[0]

      for (const { item, unitPrice, gstRate, itemTotal, gst, itemTax } of itemsWithGST) {
        const tax = isGSTEnabled && gst ? gst.totalTax : (itemTax || 0)
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, variant_name, quantity, unit_price, total_price, tax_amount, hsn_code, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [createdOrder.id, item.product_id, item.variant?.id || null,
           item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name,
           item.variant?.sku || item.products.sku,
           item.variant?.variant_name || null,
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

      for (const item of cartItems) {
        if (item.buy_mode === 'unit' || !item.buy_mode) {
          if (item.variant) {
            await client.query(
              'UPDATE product_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2',
              [item.quantity, item.variant.id]
            )
          } else {
            await client.query(
              'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
              [item.quantity, item.product_id]
            )
          }
        }
      }

      if (!isRazorpayPayment) {
        await client.query('DELETE FROM cart_items WHERE user_id = $1', [cartUserId])
      }

      return createdOrder
    })

    const orderItems = cartItems.map((item: any) => {
      const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
      const unitPrice = isCustomQty
        ? parseFloat(item.price_at_addition)
        : parseFloat(item.variant?.sale_price ?? item.variant?.price ?? item.products.sale_price ?? item.products.base_price)
      return {
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name,
        product_sku: item.variant?.sku || item.products.sku,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: unitPrice * parseFloat(item.quantity),
        buy_mode: item.buy_mode || 'unit',
        buy_unit: item.buy_unit || null,
      }
    })

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
