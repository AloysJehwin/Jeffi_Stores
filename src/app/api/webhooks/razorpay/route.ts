import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { queryOne, queryMany, query, withTransaction } from '@/lib/db'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { createAutoTask } from '@/lib/auto-tasks'
import { attributeConversion } from '@/lib/marketing'
import { verifyDraftToken, hashCartItems } from '@/lib/order-draft'
import {
  loadActiveCart, cartSubtotal, cartTaxAmount, cartItemsForHash,
  validateCouponForUser, commitOrder,
} from '@/lib/order-commit'
import { createDraftInvoice } from '@/lib/invoice'
import { getFeatureFlags } from '@/lib/site-controls'
import { settleVariantChangePayment } from '@/lib/variant-change'
import { logActivity } from '@/lib/activity'
import { recordImplicitSignalsForProducts } from '@/lib/ai-feedback'

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const webhookSignature = request.headers.get('x-razorpay-signature')

    if (!webhookSignature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!webhookSecret) {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')

    if (expectedSignature !== webhookSignature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const eventType = event.event

    if (eventType === 'payment.captured') {
      await handlePaymentCaptured(event.payload.payment.entity)
    } else if (eventType === 'payment.failed') {
      await handlePaymentFailed(event.payload.payment.entity)
    } else if (eventType === 'payment_link.paid') {
      await handlePaymentLinkPaid(event.payload.payment_link.entity)
    } else if (eventType === 'payment_link.expired') {
      await handlePaymentLinkExpired(event.payload.payment_link.entity)
    } else if (eventType === 'qr_code.credited') {
      await handleQrCodeCredited(event.payload.qr_code.entity)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return NextResponse.json({ status: 'ok' })
  }
}

async function handlePaymentCaptured(payment: any) {
  const razorpayOrderId = payment.order_id
  const razorpayPaymentId = payment.id

  const paymentRecord = await queryOne(
    `SELECT p.id as payment_id, p.order_id, p.status as payment_record_status,
            o.id as db_order_id, o.payment_status, o.order_number, o.total_amount,
            o.customer_email, o.customer_name, o.user_id
     FROM payments p
     JOIN orders o ON p.order_id = o.id
     WHERE p.gateway_response->>'razorpay_order_id' = $1
     LIMIT 1`,
    [razorpayOrderId]
  )

  if (!paymentRecord) {
    // Variant-change top-up: order created for a pending variant_change request.
    const vcr = await queryOne<{ id: string }>(
      `SELECT id FROM variant_change_requests WHERE razorpay_order_id = $1 AND status = 'awaiting_payment'`,
      [razorpayOrderId]
    )
    if (vcr) {
      await settleVariantChangePayment({ razorpayOrderId, razorpayPaymentId, amountPaise: Number(payment.amount) || 0 }).catch(() => {})
      return
    }
    // Draft-token flow: no payments row yet — try pending_payment_intents fallback
    await commitDraftFromWebhook(razorpayOrderId, razorpayPaymentId, payment)
    return
  }
  if (paymentRecord.payment_status === 'paid') return

  const orderId = paymentRecord.order_id

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )

    await client.query(
      `UPDATE payments
       SET transaction_id = $1, status = 'completed',
           gateway_response = $2, updated_at = NOW()
       WHERE order_id = $3 AND payment_gateway = 'razorpay' AND status = 'pending'`,
      [
        razorpayPaymentId,
        JSON.stringify({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, ...payment }),
        orderId,
      ]
    )

    if (paymentRecord.user_id) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [paymentRecord.user_id])
    }
  })

  if (paymentRecord.user_id) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [paymentRecord.user_id])
    const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId])
    const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [orderId])

    if (user && order) {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      sendOrderConfirmationEmail(user.email, order, orderItems || []).catch(() => {})
      sendNewOrderNotification(order, orderItems || [], user).catch(() => {})
      sendPaymentStatusUpdate(user.email, userName, order.order_number, orderId, 'paid', parseFloat(order.total_amount)).catch(() => {})
      attributeConversion(paymentRecord.user_id, orderId).catch(() => {})
    }
  }
}

async function handlePaymentFailed(payment: any) {
  const razorpayOrderId = payment.order_id

  const paymentRecord = await queryOne(
    `SELECT p.order_id FROM payments p
     WHERE p.gateway_response->>'razorpay_order_id' = $1
     LIMIT 1`,
    [razorpayOrderId]
  )

  if (!paymentRecord) return

  await queryOne(
    `UPDATE payments SET status = 'failed', gateway_response = $1, updated_at = NOW()
     WHERE order_id = $2 AND payment_gateway = 'razorpay' AND status = 'pending'`,
    [JSON.stringify(payment), paymentRecord.order_id]
  )

  await queryOne(
    `UPDATE orders SET payment_status = 'failed', updated_at = NOW()
     WHERE id = $1 AND payment_status = 'unpaid'`,
    [paymentRecord.order_id]
  )

  const orderRow = await queryOne<{ user_id: string | null; order_number: string; total_amount: string }>(
    `SELECT user_id, order_number, total_amount FROM orders WHERE id = $1`,
    [paymentRecord.order_id]
  )
  if (orderRow?.user_id) {
    createAutoTask({
      userId: orderRow.user_id,
      sourceKind: 'contact_failed_payment',
      sourceRefId: paymentRecord.order_id,
      title: `Reach out about failed payment on #${orderRow.order_number}`,
      description: `Razorpay reported payment.failed for ₹${orderRow.total_amount}.`,
      priority: 'medium',
      dueInDays: 1,
    }).catch(() => {})
  }
}

async function handlePaymentLinkPaid(paymentLink: any) {
  const linkId = paymentLink.id

  const order = await queryOne(
    `SELECT id, payment_status, user_id, order_number, total_amount, customer_email, customer_name
     FROM orders WHERE payment_link_id = $1`,
    [linkId]
  )

  if (!order || order.payment_status === 'paid') return

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET
        payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        payment_link_status = 'paid',
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [order.id]
    )

    await client.query(
      `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay_link', $2, $3, 'completed', $4)
       ON CONFLICT DO NOTHING`,
      [order.id, paymentLink.payments?.[0]?.payment_id || linkId, parseFloat(order.total_amount), JSON.stringify(paymentLink)]
    )

    if (order.user_id) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [order.user_id])
    }
  })

  if (order.user_id) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [order.user_id])
    const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id])
    const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [order.id])
    if (user && fullOrder) {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      sendOrderConfirmationEmail(user.email, fullOrder, orderItems || []).catch(() => {})
      sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
      sendPaymentStatusUpdate(user.email, userName, order.order_number, order.id, 'paid', parseFloat(order.total_amount)).catch(() => {})
    }
  }
}

async function handleQrCodeCredited(qrCode: any) {
  const qrId = qrCode?.id
  if (!qrId) return

  const order = await queryOne<{ id: string; payment_status: string; total_amount: string }>(
    `SELECT id, payment_status, total_amount FROM orders WHERE razorpay_qr_id = $1`,
    [qrId]
  )
  if (!order || order.payment_status === 'paid') return

  await query(
    `UPDATE orders SET payment_status = 'paid', updated_at = NOW()
     WHERE razorpay_qr_id = $1 AND payment_status != 'paid'`,
    [qrId]
  )
  await query(
    `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay_qr', $2, $3, 'completed', $4)
     ON CONFLICT DO NOTHING`,
    [order.id, qrCode.payments?.[0]?.razorpay_payment_id || qrId, parseFloat(order.total_amount), JSON.stringify(qrCode)]
  )
}

async function handlePaymentLinkExpired(paymentLink: any) {
  await queryOne(
    `UPDATE orders SET payment_link_status = 'expired', updated_at = NOW()
     WHERE payment_link_id = $1 AND payment_link_status = 'created'`,
    [paymentLink.id]
  )
}

async function commitDraftFromWebhook(razorpayOrderId: string, razorpayPaymentId: string, payment: any) {
  // Atomically claim the intent — prevents double-commit with verify route
  const intent = await queryOne<{
    id: string; draft_token: string; user_id: string; amount_paise: number
  }>(
    `UPDATE pending_payment_intents SET committed = true
     WHERE razorpay_order_id = $1 AND committed = false
     RETURNING id, draft_token, user_id, amount_paise`,
    [razorpayOrderId]
  )
  if (!intent) return // already committed or not a draft-token payment

  const draft = await verifyDraftToken(intent.draft_token)
  if (!draft) {
    // Token expired — alert admin to manually refund/create order
    await createAutoTask({
      userId: intent.user_id,
      sourceKind: 'contact_failed_payment',
      sourceRefId: intent.id,
      title: `Payment captured but draft expired — manual action needed (${razorpayPaymentId})`,
      description: `Razorpay captured ₹${(intent.amount_paise / 100).toFixed(2)} but the checkout session expired. Manually create the order or issue a refund. Payment ID: ${razorpayPaymentId}`,
      priority: 'high',
      dueInDays: 0,
    }).catch(() => {})
    return
  }

  // Amount validation — abort if Razorpay amount doesn't match intent
  const capturedPaise = payment.amount
  if (Math.abs(capturedPaise - intent.amount_paise) > 1) {
    await createAutoTask({
      userId: intent.user_id,
      sourceKind: 'contact_failed_payment',
      sourceRefId: intent.id,
      title: `Payment amount mismatch — manual action needed (${razorpayPaymentId})`,
      description: `Expected ₹${(intent.amount_paise / 100).toFixed(2)}, captured ₹${(capturedPaise / 100).toFixed(2)}. Payment ID: ${razorpayPaymentId}`,
      priority: 'high',
      dueInDays: 0,
    }).catch(() => {})
    return
  }

  const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [intent.user_id])
  if (!user) return

  let subtotal = 0
  let taxAmount = 0
  let cartItems: Awaited<ReturnType<typeof loadActiveCart>> = []
  let buyNowSnapshot: { product: any; variant: any | null; subVariant: any | null } | null = null
  const { gstEnabled } = await getFeatureFlags()

  if (draft.mode === 'cart') {
    cartItems = await loadActiveCart(intent.user_id)
    if (cartItems.length === 0) return
    subtotal = cartSubtotal(cartItems, gstEnabled)
    taxAmount = cartTaxAmount(cartItems, gstEnabled)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    const product = await queryOne<any>(`SELECT id, name, sku, gst_percentage, hsn_code, mrp, extra_delivery_days FROM products WHERE id = $1`, [draft.buyNowItem.productId])
    if (!product) return
    const variant = draft.buyNowItem.variantId
      ? await queryOne<any>(`SELECT id, variant_name, sku, mrp FROM product_variants WHERE id = $1`, [draft.buyNowItem.variantId])
      : null
    const subVariant = draft.buyNowItem.subVariantId
      ? await queryOne<any>(`SELECT id, sub_variant_name, sku, mrp FROM product_sub_variants WHERE id = $1`, [draft.buyNowItem.subVariantId])
      : null
    buyNowSnapshot = { product, variant, subVariant }
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
    const gstRate = parseFloat(String(product.gst_percentage || '0'))
    taxAmount = gstEnabled ? (subtotal - subtotal / (1 + gstRate / 100)) : 0
  } else {
    return
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId: intent.user_id, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }

  const created = draft.mode === 'cart'
    ? await commitOrder({
        mode: 'cart', userId: intent.user_id, user, addressId: draft.addressId,
        notes: draft.notes, couponId: draft.couponId, shippingAmount: draft.shippingAmount,
        cartItems, subtotal, taxAmount, appliedDiscount,
        businessDiscountAmount: draft.businessDiscountAmount,
        paymentRecord: {
          gatewayOrderId: razorpayOrderId, paymentId: razorpayPaymentId,
          signature: '', amountPaise: capturedPaise,
        },
      })
    : await commitOrder({
        mode: 'buyNow', userId: intent.user_id, user, addressId: draft.addressId,
        notes: draft.notes, couponId: draft.couponId, shippingAmount: draft.shippingAmount,
        item: draft.buyNowItem!, product: buyNowSnapshot!.product,
        variant: buyNowSnapshot!.variant, subVariant: buyNowSnapshot!.subVariant,
        subtotal, taxAmount, appliedDiscount,
        businessDiscountAmount: draft.businessDiscountAmount,
        paymentRecord: {
          gatewayOrderId: razorpayOrderId, paymentId: razorpayPaymentId,
          signature: '', amountPaise: capturedPaise,
        },
      })

  const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [created.id])
  createDraftInvoice(created.id).catch(() => {})
  const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [created.id])
  const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
  sendOrderConfirmationEmail(user.email, fullOrder, orderItems || []).catch(() => {})
  sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
  sendPaymentStatusUpdate(user.email, userName, created.order_number, created.id, 'paid', parseFloat(created.total_amount)).catch(() => {})
  logActivity({ userId: intent.user_id, kind: 'order_placed', referenceId: created.id, referenceType: 'orders',
    summary: `Placed order #${created.order_number} via webhook recovery`, metadata: { orderNumber: created.order_number, total: created.total_amount } }).catch(() => {})
  recordImplicitSignalsForProducts(intent.user_id, (orderItems || []).map((i: any) => i.product_id), 'purchased').catch(() => {})
  attributeConversion(intent.user_id, created.id).catch(() => {})
}
