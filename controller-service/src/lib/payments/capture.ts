import 'server-only'
import { queryOne, queryMany, query, withTransaction } from '@/lib/shared/db'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { attributeConversion } from '@/lib/shared/marketing'
import { verifyDraftToken } from '@/lib/orders/order-draft'
import { loadActiveCart, cartSubtotal, cartTaxAmount, validateCouponForUser, commitOrder } from '@/lib/orders/order-commit'
import { notifyAccessGranted } from '@/lib/shared/notify'
import { createDraftInvoice, generateOrderInvoice } from '@/lib/documents/invoice'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { settleVariantChangePayment } from '@/lib/orders/variant-change'
import { logActivity } from '@/lib/shared/activity'
import { recordImplicitSignalsForProducts } from '@/lib/shared/ai-feedback'
import { recordCapturedPayment } from '@/lib/payments/route-settlement'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { controlPlanePool } from '@/lib/tenant-registry'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'
import { isFlagship, type WebhookTenant } from '@/lib/payments/webhook-tenant'

/**
 * One path for a captured Razorpay payment, used by the webhooks, verify, check-pending and the sweep.
 * Everything here runs in the store the payment belongs to: callers wrap it in runInTenant.
 */

type Store = { tenantId: string; slug?: string | null } | null

/**
 * Books a store's share of a captured payment. The transfer API is not idempotent, so callers only
 * call this when their own UPDATE flipped the order to paid (or their intent claim won).
 */
export async function routeCapturedPayment(opts: {
  store: Store
  paymentId: string
  totalAmountInr: number
  orderId: string
  orderRef: string
  isCod?: boolean
}) {
  const store = opts.store
  if (!store || isFlagship(store)) return // the platform's own store has no tenant billing

  // The own_razorpay column and the keys that actually collected can drift. Settle on the account that
  // really holds the money: own column but platform keys → the platform must still transfer; platform
  // column but store keys → a transfer would be rejected.
  const row = await controlPlanePool()
    .query(`SELECT own_razorpay FROM tenants WHERE id=$1 AND status='active'`, [store.tenantId])
    .catch(() => null)
  const ownFlag = row?.rows[0]?.own_razorpay === true
  const { isOwn } = await resolveRazorpayCreds(store.tenantId).catch(() => ({ isOwn: ownFlag }))
  if (ownFlag !== isOwn) {
    console.warn('[routeCapturedPayment] own_razorpay/creds mismatch', { tenantId: store.tenantId, orderRef: opts.orderRef, ownFlag, isOwn })
  }

  await recordCapturedPayment({
    tenantId: store.tenantId,
    tenantSlug: store.slug ?? '',
    orderRef: opts.orderRef,
    orderId: opts.orderId,
    paymentId: opts.paymentId,
    grossInr: opts.totalAmountInr,
    collectedOn: ownFlag && isOwn ? 'own' : 'platform',
    isCod: opts.isCod,
  })
}

function sendPaidNotifications(user: any, order: any, items: any[]) {
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
  sendOrderConfirmationEmail(user.email, order, items).catch(() => {})
  sendNewOrderNotification(order, items, user).catch(() => {})
  sendPaymentStatusUpdate(user.email, name, order.order_number, order.id, 'paid', parseFloat(order.total_amount)).catch(() => {})
}

async function notifyOrderPaid(userId: string | null, orderId: string) {
  if (!userId) return
  const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId])
  const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId])
  const items = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [orderId])
  if (!user || !order) return
  sendPaidNotifications(user, order, items || [])
  attributeConversion(userId, orderId).catch(() => {})
}

/** Clears the paid-for cart, as checkout does. */
const CLEAR_CART = 'DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE'

export type CaptureOutcome = 'paid' | 'already_paid' | 'committed' | 'adjustment' | 'variant_change' | 'needs_action' | 'unmatched'

/** Applies a captured payment to the store this runs in. 'unmatched': nothing here was waiting for it. */
export async function applyCapturedPayment(payment: any, store: WebhookTenant): Promise<CaptureOutcome> {
  const rzpOrderId = payment.order_id
  const paymentId = payment.id
  const amountPaise = Number(payment.amount) || 0

  const record = await queryOne(
    `SELECT p.id as payment_id, p.order_id, p.status as payment_record_status,
            o.id as db_order_id, o.payment_status, o.order_number, o.total_amount, o.shipping_amount,
            o.customer_email, o.customer_name, o.user_id, o.gclid, o.gbraid, o.wbraid
     FROM payments p
     JOIN orders o ON p.order_id = o.id
     WHERE p.gateway_response->>'razorpay_order_id' = $1
     LIMIT 1`,
    [rzpOrderId]
  )

  // A product-adjustment top-up whose browser never reached verify.
  if (payment?.notes?.purpose === 'order_adjustment' && rzpOrderId) {
    const { settleAdjustmentPayment } = await import('@/lib/orders/adjustments')
    const tenant = isFlagship(store) ? null : { tenantId: store.tenantId, slug: store.slug }
    await settleAdjustmentPayment({ razorpayOrderId: rzpOrderId, razorpayPaymentId: paymentId, amountPaise, tenant }).catch(e =>
      console.error('[capture] order adjustment settle failed', e)
    )
    return 'adjustment'
  }

  if (!record) {
    const vcr = await queryOne<{ id: string }>(
      `SELECT id FROM variant_change_requests WHERE razorpay_order_id = $1 AND status = 'awaiting_payment'`,
      [rzpOrderId]
    )
    if (vcr) {
      await settleVariantChangePayment({ razorpayOrderId: rzpOrderId, razorpayPaymentId: paymentId, amountPaise }).catch(() => {})
      return 'variant_change'
    }
    const r = await commitDraftFromCapture(rzpOrderId, payment, store)
    return r.status === 'committed' ? 'committed' : r.status === 'not_claimed' ? 'unmatched' : 'needs_action'
  }
  if (record.payment_status === 'paid') return 'already_paid'

  const orderId = record.order_id
  let flipped = false
  await withTransaction(async client => {
    const upd = await client.query(
      `UPDATE orders SET payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )
    flipped = (upd.rowCount ?? 0) > 0
    await client.query(
      `UPDATE payments
       SET transaction_id = $1, status = 'completed',
           gateway_response = $2, updated_at = NOW()
       WHERE order_id = $3 AND payment_gateway = 'razorpay' AND status = 'pending'`,
      [paymentId, JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, ...payment }), orderId]
    )
    if (record.user_id) await client.query(CLEAR_CART, [record.user_id])
  })
  await queueAdsConversion(orderId, record)
  await notifyOrderPaid(record.user_id, orderId)

  if (flipped) {
    routeCapturedPayment({
      store,
      paymentId,
      totalAmountInr: parseFloat(record.total_amount),
      orderId,
      orderRef: record.order_number,
    }).catch(() => {})
  }
  return 'paid'
}

/** A payment-link payment: the order the link was made for is paid. */
export async function applyLinkPayment(link: any, payment: any, store: WebhookTenant): Promise<CaptureOutcome> {
  const linkId = link?.id
  if (!linkId) return 'unmatched'
  const order = await queryOne(
    `SELECT id, payment_status, user_id, order_number, total_amount, shipping_amount, customer_email, customer_name,
            gclid, gbraid, wbraid
     FROM orders WHERE payment_link_id = $1`,
    [linkId]
  )
  if (!order) return 'unmatched'
  if (order.payment_status === 'paid') return 'already_paid'
  // The link entity carries no payment list; the event's payment entity does.
  const paymentId = payment?.id || link.payments?.[0]?.payment_id || null

  let flipped = false
  await withTransaction(async client => {
    const upd = await client.query(
      `UPDATE orders SET
        payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        payment_link_status = 'paid',
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [order.id]
    )
    flipped = (upd.rowCount ?? 0) > 0
    await client.query(
      `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay_link', $2, $3, 'completed', $4)
       ON CONFLICT DO NOTHING`,
      [order.id, paymentId || linkId, parseFloat(order.total_amount), JSON.stringify({ ...link, razorpay_payment_id: paymentId })]
    )
    if (order.user_id) await client.query(CLEAR_CART, [order.user_id])
  })
  await queueAdsConversion(order.id, order)

  if (order.user_id) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [order.user_id])
    const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id])
    const items = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [order.id])
    if (user && fullOrder) sendPaidNotifications(user, fullOrder, items || [])
  }

  if (flipped && paymentId) {
    routeCapturedPayment({ store, paymentId, totalAmountInr: parseFloat(order.total_amount), orderId: order.id, orderRef: order.order_number }).catch(() => {})
  }
  return 'paid'
}

/** A UPI QR payment (invoice QR): the order the QR was made for is paid. */
export async function applyQrPayment(qr: any, payment: any, store: WebhookTenant): Promise<CaptureOutcome> {
  const qrId = qr?.id
  if (!qrId) return 'unmatched'
  const order = await queryOne<{
    id: string
    payment_status: string
    total_amount: string
    shipping_amount: string
    order_number: string
    gclid: string | null
    gbraid: string | null
    wbraid: string | null
  }>(
    `SELECT id, payment_status, total_amount, shipping_amount, order_number, gclid, gbraid, wbraid
     FROM orders WHERE razorpay_qr_id = $1`,
    [qrId]
  )
  if (!order) return 'unmatched'
  if (order.payment_status === 'paid') return 'already_paid'

  const upd = await query(`UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE razorpay_qr_id = $1 AND payment_status != 'paid'`, [qrId])
  const flipped = (upd.rowCount ?? 0) > 0
  // The QR entity has no payment list; the event's payment entity names the payment.
  const paymentId = payment?.id || qr.payments?.[0]?.razorpay_payment_id || null
  await query(
    `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay_qr', $2, $3, 'completed', $4)
     ON CONFLICT DO NOTHING`,
    [order.id, paymentId || qrId, parseFloat(order.total_amount), JSON.stringify({ ...qr, razorpay_payment_id: paymentId })]
  )
  if (flipped) await queueAdsConversion(order.id, order)

  if (flipped && paymentId) {
    routeCapturedPayment({ store, paymentId, totalAmountInr: parseFloat(order.total_amount), orderId: order.id, orderRef: order.order_number }).catch(() => {})
  }
  return 'paid'
}

export type DraftCommit =
  | { status: 'committed'; order: { id: string; order_number: string; total_amount: string } }
  | { status: 'not_claimed' }
  | { status: 'needs_action'; reason: string }

/**
 * Creates the order for a checkout whose browser never came back to verify. The atomic intent claim
 * elects one winner between this and verify, so the order and its transfer happen once.
 */
export async function commitDraftFromCapture(
  rzpOrderId: string,
  payment: any,
  store: WebhookTenant,
  opts: { via?: string } = {}
): Promise<DraftCommit> {
  const paymentId = payment.id
  const intent = await queryOne<{ id: string; draft_token: string; user_id: string; amount_paise: number }>(
    `UPDATE pending_payment_intents SET committed = true
     WHERE razorpay_order_id = $1 AND committed = false
     RETURNING id, draft_token, user_id, amount_paise`,
    [rzpOrderId]
  )
  if (!intent) return { status: 'not_claimed' }

  // The payment is captured but no order can be made from it: someone has to create it or refund.
  const manual = (title: string, description: string): DraftCommit => {
    createAutoTask({
      userId: intent.user_id,
      sourceKind: 'contact_failed_payment',
      sourceRefId: intent.id,
      title: `${title} — manual action needed (${paymentId})`,
      description: `${description} Manually create the order or issue a refund. Payment ID: ${paymentId}`,
      priority: 'high',
      dueInDays: 0,
    }).catch(() => {})
    return { status: 'needs_action', reason: title }
  }

  const draft = await verifyDraftToken(intent.draft_token)
  if (!draft) return manual('Payment captured but draft expired', `Razorpay captured ₹${(intent.amount_paise / 100).toFixed(2)} but the checkout session expired.`)

  const capturedPaise = payment.amount
  if (Math.abs(capturedPaise - intent.amount_paise) > 1) {
    return manual('Payment amount mismatch', `Expected ₹${(intent.amount_paise / 100).toFixed(2)}, captured ₹${(capturedPaise / 100).toFixed(2)}.`)
  }

  const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [intent.user_id])
  if (!user) return manual('Payment captured for a missing customer', 'The customer account no longer exists.')

  let subtotal = 0
  let taxAmount = 0
  let cartItems: Awaited<ReturnType<typeof loadActiveCart>> = []
  let buyNowSnapshot: { product: any; variant: any | null; subVariant: any | null } | null = null
  const { gstEnabled } = await getFeatureFlags()

  if (draft.mode === 'cart') {
    cartItems = await loadActiveCart(intent.user_id)
    if (cartItems.length === 0) return manual('Payment captured but the cart is empty', 'The cart was emptied before the order could be created.')
    subtotal = cartSubtotal(cartItems, gstEnabled)
    taxAmount = cartTaxAmount(cartItems, gstEnabled)
  } else if (draft.mode === 'buyNow' && draft.buyNowItem) {
    const product = await queryOne<any>(
      `SELECT id, name, sku, gst_percentage, hsn_code, mrp, extra_delivery_days FROM products WHERE id = $1`,
      [draft.buyNowItem.productId]
    )
    if (!product) return manual('Payment captured but the product is gone', 'The product was removed before the order could be created.')
    const variant = draft.buyNowItem.variantId
      ? await queryOne<any>(`SELECT id, variant_name, sku, mrp FROM product_variants WHERE id = $1`, [draft.buyNowItem.variantId])
      : null
    const subVariant = draft.buyNowItem.subVariantId
      ? await queryOne<any>(`SELECT id, sub_variant_name, sku, mrp FROM product_sub_variants WHERE id = $1`, [draft.buyNowItem.subVariantId])
      : null
    buyNowSnapshot = { product, variant, subVariant }
    subtotal = draft.buyNowItem.price * draft.buyNowItem.qty
    const gstRate = parseFloat(String(product.gst_percentage || '0'))
    taxAmount = gstEnabled ? subtotal - subtotal / (1 + gstRate / 100) : 0
  } else {
    return manual('Payment captured for an unreadable checkout', 'The checkout session could not be read.')
  }

  let appliedDiscount = 0
  if (draft.couponId) {
    const r = await validateCouponForUser({ couponId: draft.couponId, userId: intent.user_id, subtotal })
    if (r.ok) appliedDiscount = r.appliedDiscount
  }

  const paymentRecord = { gatewayOrderId: rzpOrderId, paymentId, signature: '', amountPaise: capturedPaise }
  const common = {
    userId: intent.user_id,
    user,
    addressId: draft.addressId,
    notes: draft.notes,
    couponId: draft.couponId,
    shippingAmount: draft.shippingAmount,
    codFeeAmount: draft.codFeeAmount,
    subtotal,
    taxAmount,
    appliedDiscount,
    businessDiscountAmount: draft.businessDiscountAmount,
    paymentRecord,
  }
  let created: Awaited<ReturnType<typeof commitOrder>>
  try {
    created =
      draft.mode === 'cart'
        ? await commitOrder({ mode: 'cart', ...common, cartItems })
        : await commitOrder({
            mode: 'buyNow',
            ...common,
            item: draft.buyNowItem!,
            product: buyNowSnapshot!.product,
            variant: buyNowSnapshot!.variant,
            subVariant: buyNowSnapshot!.subVariant,
          })
  } catch (e: any) {
    return manual('Payment captured but the order failed', `Creating the order failed: ${e?.message || e}.`)
  }

  const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [created.id])
  // An all-digital order is fulfilled at payment ('granted'), so number its invoice now.
  const draftInvoice = createDraftInvoice(created.id).catch(() => {})
  if (created.status === 'granted') {
    draftInvoice.then(() => generateOrderInvoice(created.id)).catch(() => {})
    notifyAccessGranted(intent.user_id, created.order_number).catch(() => {})
  }
  const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [created.id])
  sendPaidNotifications(user, fullOrder || created, orderItems || [])
  logActivity({
    userId: intent.user_id,
    kind: 'order_placed',
    referenceId: created.id,
    referenceType: 'orders',
    summary: `Placed order #${created.order_number} via ${opts.via || 'webhook recovery'}`,
    metadata: { orderNumber: created.order_number, total: created.total_amount },
  }).catch(() => {})
  recordImplicitSignalsForProducts(
    intent.user_id,
    (orderItems || []).map((i: any) => i.product_id),
    'purchased'
  ).catch(() => {})
  attributeConversion(intent.user_id, created.id).catch(() => {})

  routeCapturedPayment({
    store,
    paymentId,
    totalAmountInr: parseFloat(created.total_amount),
    orderId: created.id,
    orderRef: created.order_number,
  }).catch(() => {})

  return { status: 'committed', order: created }
}
