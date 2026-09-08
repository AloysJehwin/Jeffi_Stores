import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, withTransaction } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification } from '@/lib/email'
import { isInterState, calculateGST, round2 } from '@/lib/gst'
import { recordImplicitSignal } from '@/lib/ai-feedback'
import { resolveBuyNowItem, quoteShipping, validateCouponForUser, loadAddress } from '@/lib/order-commit'
import { getFeatureFlags, getBusinessValues } from '@/lib/site-controls'
import { computeEdd } from '@/lib/edd'
import { getBusinessDiscountMap } from '@/lib/business-discount'
import { parseBody, zUuid } from '@/lib/validate'
import { verifyIntent } from '@/lib/checkout-intent'
import { checkPincodeServiceability } from '@/lib/delhivery'

const DirectItemSchema = z.object({
  productId: zUuid,
  variantId: zUuid.nullish(),
  subVariantId: zUuid.nullish(),
  qty: z.number().positive(),
  buyMode: z.string().nullish(),
  buyUnit: z.string().nullish(),
})

const CreateDirectOrderSchema = z.object({
  // 'manual' is accepted only from the business (B2B) portal — a server check below
  // rejects it for the consumer storefront. Manual orders stay unpaid/pending (never
  // auto-confirmed), so they carry no free-order bypass.
  paymentMethod: z.enum(['razorpay', 'cod', 'manual']),
  item: DirectItemSchema.optional(),
  intent: z.string().nullish(),
  shippingAddress: z.any().optional(),
  notes: z.string().nullish(),
  couponId: z.string().nullish(),
  addressId: z.string().nullish(),
  // Shipping the client quoted + displayed. The server re-quotes authoritatively,
  // but falls back to this when the live quote is unavailable so the charged total
  // never silently diverges from what the customer saw.
  shippingAmount: z.number().nonnegative().nullish(),
  codFeeAmount: z.number().nonnegative().nullish(),
})


export async function POST(request: NextRequest) {
  try {
    const flags = await getFeatureFlags()
    const isGSTEnabled = flags.gstEnabled
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
    const parsed = parseBody(CreateDirectOrderSchema, body)
    if (!parsed.ok) return parsed.response
    const { shippingAddress, notes, paymentMethod, couponId, addressId } = parsed.data
    const clientShipping = parsed.data.shippingAmount ?? null
    const clientCodFee = parsed.data.codFeeAmount ?? null
    const isRazorpayPayment = paymentMethod === 'razorpay'
    const isCod = paymentMethod === 'cod'
    const isManual = paymentMethod === 'manual'

    // Server is authoritative on payment availability — never trust the client's method.
    if (isRazorpayPayment && !flags.razorpayEnabled) {
      return NextResponse.json({ error: 'Online payment is currently unavailable.' }, { status: 422 })
    }
    if (isCod && !flags.codEnabled) {
      return NextResponse.json({ error: 'Cash on delivery is currently unavailable.' }, { status: 422 })
    }
    // Manual (contact-for-payment) is a B2B-only method. The consumer storefront must never
    // create a manual order — that was the free-order bypass. isBusiness comes from the
    // authenticated business session, not the client body.
    if (isManual && !authUser.isBusiness) {
      return NextResponse.json({ error: 'No valid payment method selected.' }, { status: 400 })
    }
    if (!isRazorpayPayment && !isCod && !isManual) {
      return NextResponse.json({ error: 'No valid payment method selected.' }, { status: 400 })
    }

    // When an intent token is present, derive item from the server-signed intent
    // rather than trusting the raw client body — prevents qty/buyMode/buyUnit tampering.
    let item = parsed.data.item
    if (parsed.data.intent) {
      const intentData = await verifyIntent(parsed.data.intent)
      if (!intentData) {
        return NextResponse.json({ error: 'Invalid or expired checkout intent' }, { status: 400 })
      }
      if (intentData.mode === 'cart') {
        return NextResponse.json({ error: 'Cart checkout must use the cart order route' }, { status: 400 })
      }
      item = {
        productId: intentData.productId,
        variantId: intentData.variantId ?? undefined,
        subVariantId: intentData.subVariantId ?? undefined,
        qty: intentData.qty,
        buyMode: intentData.buyMode ?? undefined,
        buyUnit: intentData.buyUnit ?? undefined,
      }
    }

    if (!item || !item.productId || !item.qty) {
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

    const resolved = await resolveBuyNowItem({
      productId: String(item.productId),
      variantId: item.variantId ?? null,
      subVariantId: item.subVariantId ?? null,
      qty: Number(item.qty),
      buyMode: item.buyMode ?? undefined,
      buyUnit: item.buyUnit ?? null,
      gstEnabled: isGSTEnabled,
    })
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

    const product = await queryOne<any>(
      `SELECT p.*, p.gst_percentage, p.hsn_code FROM products p WHERE p.id = $1`,
      [resolved.item.productId]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // COD is not available for products flagged is_cod_allowed=false.
    if (isCod && product.is_cod_allowed === false) {
      return NextResponse.json({
        error: `COD is not available for: ${product.name}. Please choose online payment.`,
        codBlockedProductIds: [product.id],
      }, { status: 422 })
    }

    const variant = resolved.item.variantId
      ? await queryOne<any>('SELECT * FROM product_variants WHERE id = $1', [resolved.item.variantId])
      : null

    const unitPrice = resolved.item.price
    const qty = resolved.item.qty
    const itemTotal = round2(unitPrice * qty)
    const subtotal = itemTotal

    const minOrderSetting = await queryOne(`SELECT value FROM site_settings WHERE key = 'min_order_amount'`, [])
    const minOrderAmount = minOrderSetting ? parseFloat(minOrderSetting.value) || 0 : 0
    if (minOrderAmount > 0 && subtotal < minOrderAmount) {
      return NextResponse.json({ error: `Minimum order value is ₹${minOrderAmount}` }, { status: 400 })
    }

    let appliedDiscount = 0
    if (couponId) {
      const result = await validateCouponForUser({ couponId, userId, subtotal })
      if (result.ok) appliedDiscount = result.appliedDiscount
    }

    let businessDiscountAmount = 0
    const bizDiscountMap = await getBusinessDiscountMap(userId)
    if (product.category_id && Object.keys(bizDiscountMap).length > 0) {
      const pct = bizDiscountMap[product.category_id] ?? 0
      if (pct > 0) {
        businessDiscountAmount = round2(subtotal * pct / 100)
      }
    }

    const destinationPin = String(shippingAddress?.postalCode || shippingAddress?.postal_code || '')
    // Serviceability gate: the buyer's pincode must be one Delhivery actually delivers to.
    // The rate endpoint quotes a charge even for unserviceable pins, so this is checked
    // explicitly and authoritatively here — never trust the client's shown quote.
    if (destinationPin) {
      const service = await checkPincodeServiceability(destinationPin)
      if (!service.serviceable) {
        return NextResponse.json({ error: 'Delivery is not available to this pincode.', unserviceable: true }, { status: 422 })
      }
      if (isCod && !service.cod) {
        return NextResponse.json({ error: 'Cash on delivery is not available to this pincode. Please choose online payment.' }, { status: 422 })
      }
    }
    // Authoritative server re-quote (with the correct COD flag). If the live quote
    // is unavailable (Delhivery timeout/error → 0) but the client displayed a
    // shipping amount, fall back to that so the charged total matches the shown
    // total instead of silently dropping shipping to 0.
    const quoted = destinationPin
      ? await quoteShipping({
          destinationPin,
          items: [{ productId: resolved.item.productId, variantId: resolved.item.variantId, subVariantId: resolved.item.subVariantId, quantity: resolved.item.qty }],
          subtotal,
          isCod,
        })
      : { shipping: 0, codFee: 0 }
    const quoteResolved = quoted.shipping > 0
    const appliedShipping = quoteResolved ? quoted.shipping : (clientShipping != null ? round2(clientShipping) : 0)
    const appliedCodFee = !isCod ? 0
      : quoteResolved ? quoted.codFee
      : (clientCodFee != null ? round2(clientCodFee) : 0)

    const gstRate = parseFloat(product.gst_percentage || '0')

    let taxAmount = 0
    let orderTaxableAmount = 0
    let orderCgst = 0
    let orderSgst = 0
    let orderIgst = 0
    let isIGST = false

    if (isGSTEnabled) {
      const sellerStateCode = (await getBusinessValues()).businessStateCode
      const buyerState = shippingAddress?.state || ''
      isIGST = isInterState(buyerState, sellerStateCode)
      const gst = calculateGST(itemTotal, gstRate, isIGST)
      taxAmount = gst.totalTax
      orderTaxableAmount = round2(gst.taxableAmount)
      orderCgst = round2(gst.cgst)
      orderSgst = round2(gst.sgst)
      orderIgst = round2(gst.igst)
    } else {
      // GST off ⇒ unitPrice is already the ex-GST price ⇒ no embedded tax.
      taxAmount = 0
    }

    const total = Math.max(0, subtotal - appliedDiscount - businessDiscountAmount + appliedShipping + appliedCodFee)
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const _eddPin = String(destinationPin || '')
    const _eddOrigin = (await getBusinessValues()).delhiveryOriginPincode
    const _edd = computeEdd({
      pin: _eddPin,
      originPin: _eddOrigin,
      handlingDays: Number(product.handling_days ?? 2),
      extraDays: Number(product.extra_delivery_days ?? 0),
    })

    const order = await withTransaction(async (client) => {
      let shippingAddressId = null
      let billingAddressId = null
      let shippingAddressSnapshot = null

      if (shippingAddress) {
        const fullName = shippingAddress.fullName || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
        const phone = shippingAddress.phone || user.phone || '0000000000'

        const existingAddress = await client.query(
          `SELECT * FROM addresses WHERE user_id = $1 AND address_line1 = $2 AND city = $3 AND postal_code = $4 LIMIT 1`,
          [userId, shippingAddress.addressLine1, shippingAddress.city, shippingAddress.postalCode]
        )

        if (existingAddress.rows[0]) {
          shippingAddressId = existingAddress.rows[0].id
          billingAddressId = existingAddress.rows[0].id
          shippingAddressSnapshot = existingAddress.rows[0]
        } else {
          const addressResult = await client.query(
            `INSERT INTO addresses (user_id, address_type, full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
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

      let addrSnapshot: object | null = null
      if (shippingAddressId) {
        const addrRow = await client.query(
          'SELECT full_name, phone, address_line1, address_line2, landmark, city, state, postal_code, country FROM addresses WHERE id = $1',
          [shippingAddressId]
        )
        addrSnapshot = addrRow.rows[0] || null
      }

      const orderResult = await client.query(
        `INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, status, payment_status, payment_mode, subtotal, discount_amount, business_discount_amount, tax_amount, shipping_amount, total_amount, shipping_address_id, billing_address_id, notes, taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst, order_type, shipping_address_snapshot, billing_address_snapshot, estimated_delivery_date, cod_fee_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'direct', $23, $24, $25, $26)
         RETURNING *`,
        [orderNumber, userId, user.email, user.phone,
         `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
         'pending',
         isCod ? 'cod_pending' : 'unpaid',
         isCod ? 'cod' : isManual ? 'manual' : 'razorpay',
         subtotal, round2(appliedDiscount), round2(businessDiscountAmount), round2(taxAmount), appliedShipping, total,
         shippingAddressId, billingAddressId,
         notes || null,
         isGSTEnabled ? orderTaxableAmount : 0,
         isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST,
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null),
         shippingAddressSnapshot ? JSON.stringify(shippingAddressSnapshot) : (addrSnapshot ? JSON.stringify(addrSnapshot) : null),
         _edd, round2(appliedCodFee)]
      )

      const createdOrder = orderResult.rows[0]

      let gstForItem = null
      if (isGSTEnabled) {
        gstForItem = calculateGST(itemTotal, gstRate, isIGST)
      }
      const itemTaxAmount = isGSTEnabled && gstForItem ? gstForItem.totalTax : taxAmount

      // Product-level discount: discount_pct is on the product, shared across all variants
      const productDiscPct = Number(product.discount_pct ?? 0)
      const mrpUnitPrice = productDiscPct > 0 ? unitPrice / (1 - productDiscPct / 100) : unitPrice
      const itemProductDiscount = productDiscPct > 0 ? round2((mrpUnitPrice - unitPrice) * qty) : 0
      const totalItemDiscount = round2(businessDiscountAmount + itemProductDiscount)

      const itemMrp = variant?.mrp != null ? Number(variant.mrp) : (product.mrp != null ? Number(product.mrp) : null)

      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, variant_name, quantity, unit_price, total_price, discount_amount, tax_amount, hsn_code, gst_rate, taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit, mrp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [createdOrder.id, item.productId, item.variantId || null,
         variant ? `${product.name} - ${variant.variant_name}` : product.name,
         variant?.sku || product.sku,
         variant?.variant_name || null,
         qty, unitPrice, itemTotal, totalItemDiscount,
         round2(itemTaxAmount),
         isGSTEnabled ? (product.hsn_code || null) : null,
         isGSTEnabled ? gstRate : null,
         isGSTEnabled && gstForItem ? gstForItem.taxableAmount : 0,
         isGSTEnabled && gstForItem ? gstForItem.cgst : 0,
         isGSTEnabled && gstForItem ? gstForItem.sgst : 0,
         isGSTEnabled && gstForItem ? gstForItem.igst : 0,
         item.buyMode || 'unit',
         item.buyUnit || null,
         itemMrp]
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

    if (isCod) {
      // COD orders confirm on placement (payment is collected on delivery).
      // Mirrors the cart path (orders/create). Razorpay confirms only after HMAC verify.
      await query(`UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`, [order.id])
      order.status = 'confirmed'
      sendOrderConfirmationEmail(user.email, order, orderItems).catch(() => {})
      sendNewOrderNotification(order, orderItems, user).catch(() => {})
    }

    recordImplicitSignal(userId, item.productId, 'purchased').catch(() => {})

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
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
