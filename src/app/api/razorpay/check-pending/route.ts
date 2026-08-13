import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne, queryMany, query } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { getRazorpayInstance } from '@/lib/razorpay'
import { verifyDraftToken, hashCartItems } from '@/lib/order-draft'
import {
  loadActiveCart, cartSubtotal, cartTaxAmount, cartItemsForHash,
  validateCouponForUser, commitOrder,
} from '@/lib/order-commit'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { createDraftInvoice } from '@/lib/invoice'
import { getFeatureFlags } from '@/lib/site-controls'
import { logActivity } from '@/lib/activity'
import { recordImplicitSignalsForProducts } from '@/lib/ai-feedback'
import { createAutoTask } from '@/lib/auto-tasks'
import { parseBody, zNonEmpty } from '@/lib/validate'

const Schema = z.object({
  razorpayOrderId: zNonEmpty,
  draftToken: zNonEmpty,
})

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = parseBody(Schema, body)
    if (!parsed.ok) return parsed.response
    const { razorpayOrderId, draftToken } = parsed.data

    // Verify draft token belongs to this user
    const draft = await verifyDraftToken(draftToken)
    if (!draft) return NextResponse.json({ error: 'Invalid or expired checkout session' }, { status: 400 })
    if (draft.userId !== authUser.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    // Check if already committed (webhook or previous verify beat us)
    const existingOrder = await queryOne<{ id: string; order_number: string }>(
      `SELECT o.id, o.order_number FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.transaction_id IN (
         SELECT razorpay_payment_id FROM (
           SELECT (p2.gateway_response->>'razorpay_payment_id') as razorpay_payment_id
           FROM payments p2 JOIN orders o2 ON o2.id = p2.order_id
           WHERE p2.gateway_response->>'razorpay_order_id' = $1
         ) sub WHERE razorpay_payment_id IS NOT NULL
       ) LIMIT 1`,
      [razorpayOrderId]
    )

    // Simpler check via pending_payment_intents committed flag
    const intent = await queryOne<{ committed: boolean }>(
      `SELECT committed FROM pending_payment_intents WHERE razorpay_order_id = $1`,
      [razorpayOrderId]
    )

    if (existingOrder) {
      return NextResponse.json({ order: { id: existingOrder.id, orderNumber: existingOrder.order_number } })
    }

    // Fetch Razorpay order status
    const razorpay = getRazorpayInstance()
    const rzpOrder = await (razorpay.orders as any).fetch(razorpayOrderId)

    if (rzpOrder.status === 'paid') {
      // Payment was captured — fetch payment details and commit
      const payments = await (razorpay.orders as any).fetchPayments(razorpayOrderId)
      const capturedPayment = payments?.items?.find((p: any) => p.status === 'captured')
      if (!capturedPayment) {
        return NextResponse.json({ status: 'pending', error: 'Payment processing — please wait.' })
      }

      // Atomically claim the intent to prevent double-commit with webhook
      const claimed = await queryOne<{ id: string }>(
        `UPDATE pending_payment_intents SET committed = true
         WHERE razorpay_order_id = $1 AND committed = false
         RETURNING id`,
        [razorpayOrderId]
      )
      if (!claimed) {
        // Webhook may have just committed it — check again
        await new Promise(r => setTimeout(r, 1000))
        const committed = await queryOne<{ id: string; order_number: string }>(
          `SELECT o.id, o.order_number FROM orders o
           JOIN payments p ON p.order_id = o.id
           WHERE p.gateway_response->>'razorpay_order_id' = $1 LIMIT 1`,
          [razorpayOrderId]
        )
        if (committed) return NextResponse.json({ order: { id: committed.id, orderNumber: committed.order_number } })
        return NextResponse.json({ status: 'pending', error: 'Payment is being processed. Check My Orders shortly.' })
      }

      const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [authUser.userId])
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      let subtotal = 0, taxAmount = 0
      let cartItems: Awaited<ReturnType<typeof loadActiveCart>> = []
      let buyNowSnapshot: { product: any; variant: any | null; subVariant: any | null } | null = null
      const { gstEnabled } = await getFeatureFlags()

      if (draft.mode === 'cart') {
        cartItems = await loadActiveCart(authUser.userId)
        if (cartItems.length === 0) {
          return NextResponse.json({ error: 'Cart is empty — cannot create order. Contact support with payment ID: ' + capturedPayment.id }, { status: 409 })
        }
        subtotal = cartSubtotal(cartItems, gstEnabled)
        taxAmount = cartTaxAmount(cartItems, gstEnabled)
      } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
        const product = await queryOne<any>(`SELECT id, name, sku, gst_percentage, hsn_code, mrp, extra_delivery_days FROM products WHERE id = $1`, [draft.buyNowItem.productId])
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
        taxAmount = gstEnabled ? (subtotal - subtotal / (1 + gstRate / 100)) : 0
      } else {
        return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
      }

      let appliedDiscount = 0
      if (draft.couponId) {
        const r = await validateCouponForUser({ couponId: draft.couponId, userId: authUser.userId, subtotal })
        if (r.ok) appliedDiscount = r.appliedDiscount
      }

      const created = draft.mode === 'cart'
        ? await commitOrder({
            mode: 'cart', userId: authUser.userId, user, addressId: draft.addressId,
            notes: draft.notes, couponId: draft.couponId, shippingAmount: draft.shippingAmount,
            cartItems, subtotal, taxAmount, appliedDiscount,
            businessDiscountAmount: draft.businessDiscountAmount,
            paymentRecord: {
              gatewayOrderId: razorpayOrderId, paymentId: capturedPayment.id,
              signature: '', amountPaise: capturedPayment.amount,
            },
          })
        : await commitOrder({
            mode: 'buyNow', userId: authUser.userId, user, addressId: draft.addressId,
            notes: draft.notes, couponId: draft.couponId, shippingAmount: draft.shippingAmount,
            item: draft.buyNowItem!, product: buyNowSnapshot!.product,
            variant: buyNowSnapshot!.variant, subVariant: buyNowSnapshot!.subVariant,
            subtotal, taxAmount, appliedDiscount,
            businessDiscountAmount: draft.businessDiscountAmount,
            paymentRecord: {
              gatewayOrderId: razorpayOrderId, paymentId: capturedPayment.id,
              signature: '', amountPaise: capturedPayment.amount,
            },
          })

      const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [created.id])
      createDraftInvoice(created.id).catch(() => {})
      const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [created.id])
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      sendOrderConfirmationEmail(user.email, fullOrder, orderItems || []).catch(() => {})
      sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
      sendPaymentStatusUpdate(user.email, userName, created.order_number, created.id, 'paid', parseFloat(created.total_amount)).catch(() => {})
      logActivity({ userId: authUser.userId, kind: 'order_placed', referenceId: created.id, referenceType: 'orders',
        summary: `Placed order #${created.order_number} via payment recovery`, metadata: { orderNumber: created.order_number, total: created.total_amount } }).catch(() => {})
      recordImplicitSignalsForProducts(authUser.userId, (orderItems || []).map((i: any) => i.product_id), 'purchased').catch(() => {})

      return NextResponse.json({ order: { id: created.id, orderNumber: created.order_number } })
    }

    if (rzpOrder.status === 'created' || rzpOrder.status === 'attempted') {
      return NextResponse.json({ status: 'pending', error: 'Payment not yet completed.' })
    }

    return NextResponse.json({ status: 'not_paid', error: 'Payment was not completed. Your cart has been restored.' })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not check payment status' }, { status: 500 })
  }
}
