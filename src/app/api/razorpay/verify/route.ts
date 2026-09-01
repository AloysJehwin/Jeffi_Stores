import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { queryOne, queryMany, query, withTransaction } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { createDraftInvoice } from '@/lib/invoice'
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
import { parseBody, zNonEmpty, zUuid } from '@/lib/validate'
import { sendOrderConfirmedSMS } from '@/lib/sms'
import { getFeatureFlags } from '@/lib/site-controls'
import { getRazorpayInstance } from '@/lib/razorpay'
import { settleVariantChangePayment } from '@/lib/variant-change'
import { getCurrentTenant } from '@/lib/tenant-context'
import { transferToLinkedAccount } from '@/lib/razorpay-route'
import { controlPlanePool } from '@/lib/tenant-registry'

const VerifySchema = z.object({
  razorpay_order_id: zNonEmpty,
  razorpay_payment_id: zNonEmpty,
  razorpay_signature: zNonEmpty,
  orderId: zUuid.nullish(),
  draftToken: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const isBusiness = authUser.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    const body = await request.json()
    const parsed = parseBody(VerifySchema, body)
    if (!parsed.ok) return parsed.response
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId, draftToken } = parsed.data

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
        isBusiness,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      })
    }

    // Variant-change top-up: no draftToken/orderId, but the razorpay order was
    // created for a pending variant_change request. Signature is already verified
    // above. Apply the swap now that the extra amount is paid.
    const vcr = await queryOne<{ id: string; amountPaise: number | null }>(
      `SELECT id FROM variant_change_requests WHERE razorpay_order_id = $1 AND status = 'awaiting_payment'`,
      [razorpay_order_id]
    )
    if (vcr) {
      let amountPaise = 0
      try {
        const rzp = getRazorpayInstance() as any
        const rzpOrder = await rzp.orders.fetch(razorpay_order_id)
        amountPaise = Number(rzpOrder?.amount) || 0
      } catch { /* fall back to 0 — settle records the payment regardless */ }
      const result = await settleVariantChangePayment({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, amountPaise })
      if (!result.applied && result.reason !== 'already_applied') {
        return NextResponse.json({ error: `Payment received but change could not be applied: ${result.reason}. Contact support.` }, { status: 409 })
      }
      return NextResponse.json({ success: true, settlement: 'variant_change_applied' })
    }

    return NextResponse.json({ error: 'draftToken or orderId is required' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Payment verification failed' }, { status: 500 })
  }
}

async function fireRouteTransfer(opts: {
  paymentId: string
  totalAmountInr: number
  orderId: string
  orderRef: string
  isCod: boolean
}) {
  const tenant = getCurrentTenant()
  if (!tenant?.tenantId) return  // platform's own store — no Route transfer needed

  // Fetch linked account id from control plane
  const pool = controlPlanePool()
  // Razorpay cannot suspend or delete a linked account through its API, so a deprovisioned
  // tenant's account outlives the tenant. Gating on status is what actually makes it inert:
  // never move money into an account whose store is suspended or terminated.
  const row = await pool.query(
    `SELECT razorpay_linked_account_id FROM tenants WHERE id=$1 AND status='active'`, [tenant.tenantId]
  ).catch(() => null)
  const linkedAccountId = row?.rows[0]?.razorpay_linked_account_id
  if (!linkedAccountId) return  // not active, or no linked account yet — skip silently

  const grossPaise = Math.round(opts.totalAmountInr * 100)
  const result = await transferToLinkedAccount({
    paymentId: opts.paymentId,
    grossAmountPaise: grossPaise,
    linkedAccountId,
    isCod: opts.isCod,
    orderId: opts.orderId,
    tenantSlug: tenant.slug ?? '',
  })

  // Record in control-plane tenant_transactions for billing visibility
  await pool.query(
    `INSERT INTO tenant_transactions
       (tenant_id, order_ref, gross_amount, tenant_share, platform_commission, gateway_fee, gateway, gateway_txn_id, is_cod, status, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,'razorpay_route',$7,$8,'captured',now())
     ON CONFLICT DO NOTHING`,
    [tenant.tenantId, opts.orderRef, opts.totalAmountInr,
     result.amount / 100,
     result.platformCommissionPaise / 100,
     (result.gatewayFeePaise + result.transferFeePaise) / 100,
     result.transferId,
     opts.isCod]
  ).catch(() => {})  // non-fatal — transfer already succeeded
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

  // Idempotency: if payment already committed return existing order
  const existing = await queryOne<{ id: string; order_number: string }>(
    `SELECT o.id, o.order_number FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.transaction_id = $1 LIMIT 1`,
    [args.razorpay_payment_id]
  )
  if (existing) {
    return NextResponse.json({ success: true, order: { id: existing.id, orderNumber: existing.order_number, paymentStatus: 'paid' } })
  }

  const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [args.userId])
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  let subtotal = 0
  let taxAmount = 0
  let cartItems: Awaited<ReturnType<typeof loadActiveCart>> = []
  let buyNowSnapshot: { product: any; variant: any | null; subVariant: any | null } | null = null
  const { gstEnabled } = await getFeatureFlags()

  if (draft.mode === 'cart') {
    cartItems = await loadActiveCart(args.userId)
    if (cartItems.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    const hash = hashCartItems(cartItemsForHash(cartItems))
    if (draft.cartHash && draft.cartHash !== hash) {
      createAutoTask({
        userId: args.userId,
        sourceKind: 'contact_failed_payment',
        sourceRefId: args.razorpay_order_id,
        title: `Payment captured but cart changed — manual order needed (${args.razorpay_payment_id})`,
        description: `Razorpay captured payment but cart hash mismatched at verify time. Manually create the order or refund. Payment ID: ${args.razorpay_payment_id}`,
        priority: 'high',
        dueInDays: 0,
      }).catch(() => {})
      return NextResponse.json({
        error: 'Cart changed during payment. Payment captured — contact support to release.',
      }, { status: 409 })
    }
    subtotal = cartSubtotal(cartItems, gstEnabled)
    taxAmount = cartTaxAmount(cartItems, gstEnabled)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    const product = await queryOne<any>(
      `SELECT id, name, sku, gst_percentage, hsn_code, mrp, extra_delivery_days FROM products WHERE id = $1`,
      [draft.buyNowItem.productId]
    )
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const variant = draft.buyNowItem.variantId
      ? await queryOne<any>(`SELECT id, variant_name, sku, mrp FROM product_variants WHERE id = $1`, [draft.buyNowItem.variantId])
      : null
    const subVariant = draft.buyNowItem.subVariantId
      ? await queryOne<any>(`SELECT id, sub_variant_name, sku, mrp FROM product_sub_variants WHERE id = $1`, [draft.buyNowItem.subVariantId])
      : null
    buyNowSnapshot = { product, variant, subVariant }
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
    const gstRate = parseFloat(String(product.gst_percentage || '0'))
    // GST off ⇒ the draft price is already the ex-GST amount ⇒ no tax to strip.
    taxAmount = gstEnabled ? (subtotal - subtotal / (1 + gstRate / 100)) : 0
  } else {
    return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId: args.userId, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }

  const expectedAmountPaise = Math.round((Math.max(0, subtotal - appliedDiscount - draft.businessDiscountAmount + draft.shippingAmount + draft.codFeeAmount)) * 100)

  const created = draft.mode === 'cart'
    ? await commitOrder({
        mode: 'cart',
        userId: args.userId,
        user,
        addressId: draft.addressId,
        notes: draft.notes,
        couponId: draft.couponId,
        shippingAmount: draft.shippingAmount,
        codFeeAmount: draft.codFeeAmount,
        cartItems,
        subtotal,
        taxAmount,
        appliedDiscount,
        businessDiscountAmount: draft.businessDiscountAmount,
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
        codFeeAmount: draft.codFeeAmount,
        item: draft.buyNowItem!,
        product: buyNowSnapshot!.product,
        variant: buyNowSnapshot!.variant,
        subVariant: buyNowSnapshot!.subVariant,
        subtotal,
        taxAmount,
        appliedDiscount,
        businessDiscountAmount: draft.businessDiscountAmount,
        paymentRecord: {
          gatewayOrderId: args.razorpay_order_id,
          paymentId: args.razorpay_payment_id,
          signature: args.razorpay_signature,
          amountPaise: expectedAmountPaise,
        },
      })

  const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'

  // Mark intent committed — prevents webhook double-commit
  query(
    `UPDATE pending_payment_intents SET committed = true WHERE razorpay_order_id = $1 AND committed = false`,
    [args.razorpay_order_id]
  ).catch(() => {})

  // Route transfer — split payment to tenant's linked account (fire-and-forget)
  fireRouteTransfer({
    paymentId: args.razorpay_payment_id,
    totalAmountInr: parseFloat(created.total_amount),
    orderId: created.id,
    orderRef: created.order_number,
    isCod: false,
  }).catch(() => {})

  const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [created.id])
  createDraftInvoice(created.id).catch(() => {})

  const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [created.id])

  sendOrderConfirmationEmail(user.email, fullOrder, orderItems || []).catch(() => {})
  sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
  sendPaymentStatusUpdate(user.email, userName, created.order_number, created.id, 'paid', parseFloat(created.total_amount)).catch(() => {})
  if (user.notification_channel === 'sms' && user.phone) {
    sendOrderConfirmedSMS({ phone: user.phone, orderNumber: created.order_number, total: parseFloat(created.total_amount) }).catch(() => {})
  }

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
  isBusiness?: boolean
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}) {
  let order: any
  if (args.isBusiness) {
    const bizUser = await queryOne<{ email: string; phone: string | null }>(
      'SELECT email, phone FROM users WHERE id = $1',
      [args.userId]
    )
    const email = bizUser?.email || ''
    const phone = bizUser?.phone || null
    order = await queryOne<any>(
      `SELECT * FROM orders WHERE id = $1 AND (
        user_id = $2 OR
        (source = 'business' AND (customer_email = $3 OR ($4::text IS NOT NULL AND customer_phone = $4)))
      )`,
      [args.orderId, args.userId, email, phone]
    )
  } else {
    order = await queryOne<any>(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [args.orderId, args.userId]
    )
  }
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

  createDraftInvoice(args.orderId).catch(() => {})

  if (user) {
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
    const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [args.orderId])
    sendOrderConfirmationEmail(user.email, updatedOrder || order, orderItems || []).catch(() => {})
    sendNewOrderNotification(updatedOrder || order, orderItems || [], user).catch(() => {})
    sendPaymentStatusUpdate(user.email, userName, order.order_number, args.orderId, 'paid', parseFloat(order.total_amount)).catch(() => {})
    if (user.notification_channel === 'sms' && user.phone) {
      sendOrderConfirmedSMS({ phone: user.phone, orderNumber: order.order_number, total: parseFloat(order.total_amount) }).catch(() => {})
    }

    recordImplicitSignalsForProducts(args.userId, (orderItems || []).map((i: any) => i.product_id), 'purchased').catch(() => {})

    // Route transfer for tenant storefront payments
    fireRouteTransfer({
      paymentId: args.razorpay_payment_id,
      totalAmountInr: parseFloat(order.total_amount),
      orderId: args.orderId,
      orderRef: order.order_number,
      isCod: false,
    }).catch(() => {})
  }

  return NextResponse.json({
    success: true,
    order: { id: order.id, orderNumber: order.order_number, paymentStatus: 'paid' },
  })
}
