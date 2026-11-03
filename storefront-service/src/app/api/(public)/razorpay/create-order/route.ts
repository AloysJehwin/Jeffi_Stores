import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/payments/razorpay'
import { verifyDraftToken, hashCartItems } from '@/lib/orders/order-draft'
import { loadActiveCart, cartSubtotal, cartItemsForHash, validateCouponForUser } from '@/lib/orders/order-commit'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'

const CreateRazorpayOrderSchema = z.object({
  draftToken: z.string().nullish(),
  orderId: zNonEmpty.nullish(),
})

export async function POST(request: NextRequest) {
  try {
    if (!(await isRazorpayEnabled())) {
      return NextResponse.json({ error: 'Online payments are not available' }, { status: 400 })
    }

    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const isBusiness = authUser.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    const body = await request.json()
    const parsed = parseBody(CreateRazorpayOrderSchema, body)
    if (!parsed.ok) return parsed.response

    if (typeof body.draftToken === 'string' && body.draftToken) {
      return await handleDraftToken(body.draftToken, authUser.userId)
    }

    if (typeof body.orderId === 'string' && body.orderId) {
      return await handleLegacyOrderId(body.orderId, authUser.userId, isBusiness)
    }

    return NextResponse.json({ error: 'draftToken or orderId is required' }, { status: 400 })
  } catch (error: any) {
    const msg = error?.error?.description || error?.message || 'Failed to create payment order'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleDraftToken(token: string, userId: string) {
  const draft = await verifyDraftToken(token)
  if (!draft) return NextResponse.json({ error: 'Invalid or expired checkout session' }, { status: 400 })
  if (draft.userId !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  let subtotal = 0
  const { gstEnabled } = await getFeatureFlags()
  if (draft.mode === 'cart') {
    const cart = await loadActiveCart(userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    const hash = hashCartItems(cartItemsForHash(cart))
    if (draft.cartHash && draft.cartHash !== hash) {
      return NextResponse.json(
        { error: 'Cart changed since checkout was started. Please review and try again.' },
        { status: 409 }
      )
    }
    subtotal = cartSubtotal(cart, gstEnabled)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
  } else {
    return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }

  const total = Math.max(
    0,
    subtotal - appliedDiscount - (draft.businessDiscountAmount || 0) + (draft.shippingAmount || 0)
  )
  const amountInPaise = Math.round(total * 100)
  if (amountInPaise <= 0) {
    return NextResponse.json({ error: 'Order total must be greater than zero' }, { status: 400 })
  }

  const tenant = await resolveRequestTenant()
  const { instance: razorpay, creds } = await getRazorpayInstanceFor(tenant?.tenantId)
  const receipt = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 40)
  const razorpayOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt,
    notes: {
      user_id: userId,
      mode: draft.mode,
      tenant_id: tenant?.tenantId ?? '',
      tenant_slug: tenant?.slug ?? '',
    },
  })

  // Store intent so webhook can recover if verify never completes
  await query(
    `INSERT INTO pending_payment_intents (razorpay_order_id, draft_token, user_id, amount_paise)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (razorpay_order_id) DO NOTHING`,
    [razorpayOrder.id, token, userId, amountInPaise]
  )

  return NextResponse.json({
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: 'INR',
    draftToken: token,
    key_id: creds.key_id,
  })
}

async function handleLegacyOrderId(orderId: string, userId: string, isBusiness: boolean = false) {
  let order: any
  if (isBusiness) {
    const bizUser = await queryOne<{ email: string; phone: string | null }>(
      'SELECT email, phone FROM users WHERE id = $1',
      [userId]
    )
    const email = bizUser?.email || ''
    const phone = bizUser?.phone || null
    order = await queryOne(
      `SELECT id, order_number, user_id, total_amount, payment_status FROM orders
       WHERE id = $1 AND (
         user_id = $2 OR
         (source = 'business' AND (customer_email = $3 OR ($4::text IS NOT NULL AND customer_phone = $4)))
       )`,
      [orderId, userId, email, phone]
    )
  } else {
    order = await queryOne(
      'SELECT id, order_number, user_id, total_amount, payment_status FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId]
    )
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  if (order.payment_status === 'paid') {
    return NextResponse.json({ error: 'Order is already paid' }, { status: 400 })
  }

  const tenant = await resolveRequestTenant()
  const { instance: razorpay, creds } = await getRazorpayInstanceFor(tenant?.tenantId)
  const amountInPaise = Math.round(parseFloat(order.total_amount) * 100)

  const razorpayOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.order_number.slice(0, 40),
    notes: {
      order_id: order.id,
      order_number: order.order_number,
      tenant_id: tenant?.tenantId ?? '',
      tenant_slug: tenant?.slug ?? '',
    },
  })

  await queryOne(
    `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'pending', $4)
     ON CONFLICT (transaction_id) DO NOTHING
     RETURNING id`,
    [order.id, razorpayOrder.id, order.total_amount, JSON.stringify({ razorpay_order_id: razorpayOrder.id })]
  )

  return NextResponse.json({
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: 'INR',
    orderId: order.id,
    key_id: creds.key_id,
  })
}
