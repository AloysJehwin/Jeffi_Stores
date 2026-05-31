import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'
import { verifyDraftToken, hashCartItems } from '@/lib/order-draft'
import {
  loadActiveCart,
  cartSubtotal,
  cartTaxAmount,
  cartItemsForHash,
  validateCouponForUser,
  commitOrder,
} from '@/lib/order-commit'
import { logActivity } from '@/lib/activity'
import { createAutoTask } from '@/lib/auto-tasks'
import { recordImplicitSignalsForProducts } from '@/lib/ai-feedback'

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId, draftToken } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    if (typeof draftToken === 'string' && draftToken) {
      return await commitDraft({
        token: draftToken,
        userId: authUser.userId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      })
    }

    if (typeof orderId === 'string' && orderId) {
      return await markLegacyOrderPaid({
        userId: authUser.userId,
        orderId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      })
    }

    return NextResponse.json({ error: 'draftToken or orderId is required' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Payment verification failed' }, { status: 500 })
  }
}

async function commitDraft(args: {
  token: string
  userId: string
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}) {
  const draft = await verifyDraftToken(args.token)
  if (!draft) return NextResponse.json({ error: 'Invalid or expired checkout session' }, { status: 400 })
  if (draft.userId !== args.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [args.userId])
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  let subtotal = 0
  let taxAmount = 0
  let cartItems: Awaited<ReturnType<typeof loadActiveCart>> = []
  let buyNowSnapshot: { product: any; variant: any | null } | null = null

  if (draft.mode === 'cart') {
    cartItems = await loadActiveCart(args.userId)
    if (cartItems.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    const hash = hashCartItems(cartItemsForHash(cartItems))
    if (draft.cartHash && draft.cartHash !== hash) {
      return NextResponse.json({
        error: 'Cart changed during payment. Payment captured — contact support to release.',
      }, { status: 409 })
    }
    subtotal = cartSubtotal(cartItems)
    taxAmount = cartTaxAmount(cartItems)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    const product = await queryOne<any>(
      `SELECT id, name, sku, gst_percentage, hsn_code FROM products WHERE id = $1`,
      [draft.buyNowItem.productId]
    )
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const variant = draft.buyNowItem.variantId
      ? await queryOne<any>(`SELECT id, variant_name, sku FROM product_variants WHERE id = $1`, [draft.buyNowItem.variantId])
      : null
    buyNowSnapshot = { product, variant }
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
    const gstRate = parseFloat(String(product.gst_percentage || '0'))
    taxAmount = subtotal - subtotal / (1 + gstRate / 100)
  } else {
    return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId: args.userId, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }

  const expectedAmountPaise = Math.round((Math.max(0, subtotal - appliedDiscount + draft.shippingAmount)) * 100)

  const created = draft.mode === 'cart'
    ? await commitOrder({
        mode: 'cart',
        userId: args.userId,
        user,
        addressId: draft.addressId,
        notes: draft.notes,
        couponId: draft.couponId,
        shippingAmount: draft.shippingAmount,
        cartItems,
        subtotal,
        taxAmount,
        appliedDiscount,
        paymentRecord: {
          gatewayOrderId: args.razorpay_order_id,
          paymentId: args.razorpay_payment_id,
          signature: args.razorpay_signature,
          amountPaise: expectedAmountPaise,
        },
      })
    : await commitOrder({
        mode: 'buyNow',
        userId: args.userId,
        user,
        addressId: draft.addressId,
        notes: draft.notes,
        couponId: draft.couponId,
        shippingAmount: draft.shippingAmount,
        item: draft.buyNowItem!,
        product: buyNowSnapshot!.product,
        variant: buyNowSnapshot!.variant,
        subtotal,
        taxAmount,
        appliedDiscount,
        paymentRecord: {
          gatewayOrderId: args.razorpay_order_id,
          paymentId: args.razorpay_payment_id,
          signature: args.razorpay_signature,
          amountPaise: expectedAmountPaise,
        },
      })

  const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'

  const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [created.id])
  let invoicePdfBuffer: Buffer | null = null
  try { invoicePdfBuffer = await generateOrderInvoice(created.id) } catch {}

  const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [created.id])

  sendOrderConfirmationEmail(user.email, fullOrder, orderItems || [], invoicePdfBuffer).catch(() => {})
  sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
  sendPaymentStatusUpdate(user.email, userName, created.order_number, created.id, 'paid', parseFloat(created.total_amount)).catch(() => {})

  logActivity({
    userId: args.userId,
    kind: 'order_placed',
    referenceId: created.id,
    referenceType: 'orders',
    summary: `Placed order #${created.order_number} — ₹${Number(created.total_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    metadata: { orderNumber: created.order_number, total: created.total_amount, itemCount: orderItems?.length || 0 },
  }).catch(() => {})

  recordImplicitSignalsForProducts(args.userId, (orderItems || []).map((i: any) => i.product_id), 'purchased').catch(() => {})

  if (Number(created.total_amount) >= 50000) {
    createAutoTask({
      userId: args.userId,
      sourceKind: 'review_high_value_order',
      sourceRefId: created.id,
      title: `Review high-value order #${created.order_number} (₹${Number(created.total_amount).toLocaleString('en-IN')})`,
      description: 'Large order — verify stock, address, and payment before fulfilling.',
      priority: 'high',
      dueInDays: 0,
    }).catch(() => {})
  }

  return NextResponse.json({
    success: true,
    order: { id: created.id, orderNumber: created.order_number, paymentStatus: 'paid' },
  })
}

async function markLegacyOrderPaid(args: {
  userId: string
  orderId: string
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}) {
  const order = await queryOne<any>(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
    [args.orderId, args.userId]
  )
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.payment_status === 'paid') {
    return NextResponse.json({
      success: true,
      order: { id: order.id, orderNumber: order.order_number, paymentStatus: 'paid' },
    })
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [args.orderId]
    )

    const updateResult = await client.query(
      `UPDATE payments
       SET transaction_id = $1, status = 'completed',
           gateway_response = $2, updated_at = NOW()
       WHERE order_id = $3 AND transaction_id = $4 AND payment_gateway = 'razorpay' AND status = 'pending'`,
      [
        args.razorpay_payment_id,
        JSON.stringify({
          razorpay_order_id: args.razorpay_order_id,
          razorpay_payment_id: args.razorpay_payment_id,
          razorpay_signature: args.razorpay_signature,
        }),
        args.orderId,
        args.razorpay_order_id,
      ]
    )

    if (updateResult.rowCount === 0) {
      await client.query(
        `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
         VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [
          args.orderId,
          args.razorpay_payment_id,
          order.total_amount,
          JSON.stringify({
            razorpay_order_id: args.razorpay_order_id,
            razorpay_payment_id: args.razorpay_payment_id,
            razorpay_signature: args.razorpay_signature,
          }),
        ]
      )
    }

    await client.query(
      `DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE`,
      [args.userId]
    )
  })

  const [user, orderItems] = await Promise.all([
    queryOne('SELECT * FROM users WHERE id = $1', [args.userId]),
    queryMany('SELECT * FROM order_items WHERE order_id = $1', [args.orderId]),
  ])

  let invoicePdfBuffer: Buffer | null = null
  try { invoicePdfBuffer = await generateOrderInvoice(args.orderId) } catch {}

  if (user) {
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
    const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [args.orderId])
    sendOrderConfirmationEmail(user.email, updatedOrder || order, orderItems || [], invoicePdfBuffer).catch(() => {})
    sendNewOrderNotification(updatedOrder || order, orderItems || [], user).catch(() => {})
    sendPaymentStatusUpdate(user.email, userName, order.order_number, args.orderId, 'paid', parseFloat(order.total_amount)).catch(() => {})

    recordImplicitSignalsForProducts(args.userId, (orderItems || []).map((i: any) => i.product_id), 'purchased').catch(() => {})
  }

  return NextResponse.json({
    success: true,
    order: { id: order.id, orderNumber: order.order_number, paymentStatus: 'paid' },
  })
}
