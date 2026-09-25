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
import { getCurrentTenant } from '@/lib/tenant-context'
import { transferToLinkedAccount, recordTenantTransaction, recordRefundSettlement } from '@/lib/razorpay-route'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { controlPlanePool } from '@/lib/tenant-registry'

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
    } else if (eventType === 'transfer.processed') {
      await handleTransferProcessed(event.payload.transfer.entity)
    } else if (eventType === 'transfer.reversed') {
      await handleTransferReversed(event.payload.transfer.entity)
    } else if (eventType === 'refund.created' || eventType === 'refund.processed') {
      await handleRefund(event.payload.refund.entity)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return NextResponse.json({ status: 'ok' })
  }
}

async function resolveWebhookTenantId(payment: any, orderRef: string): Promise<{ tenantId: string; slug: string } | null> {
  // getCurrentTenant() is empty on the webhook (Razorpay hits a fixed URL, no host), so the
  // tenant is carried in the Razorpay order notes (set at create-order) and copied onto the
  // captured payment. Fall back to the ALS context for the platform's own store.
  const notes = payment?.notes ?? {}
  const noteTenantId = (notes.tenant_id ?? '').toString().trim()
  const noteSlug = (notes.tenant_slug ?? '').toString().trim()
  if (noteTenantId) return { tenantId: noteTenantId, slug: noteSlug }
  if (noteSlug) {
    const { lookupTenantContextBySlug } = await import('@/lib/tenant-registry')
    const ctx = await lookupTenantContextBySlug(noteSlug).catch(() => null)
    if (ctx?.tenantId) return { tenantId: ctx.tenantId, slug: noteSlug }
  }
  const t = getCurrentTenant()
  if (t?.tenantId) return { tenantId: t.tenantId, slug: t.slug ?? '' }
  return null
}

async function fireRouteTransfer(opts: {
  paymentId: string
  totalAmountInr: number
  shippingAmountInr?: number
  orderId: string
  orderRef: string
  payment: any
}) {
  const resolved = await resolveWebhookTenantId(opts.payment, opts.orderRef)
  if (!resolved) return  // platform's own store — no tenant billing

  const pool = controlPlanePool()
  // Same owner-bank fallback as the verify path: a re-provisioned tenant's acc_xxx lives on the
  // owner-scoped tenant_bank_accounts row, not the tenant row. Resolve it the way billing does.
  const row = await pool.query(
    `SELECT COALESCE(
              (SELECT b.linked_account_id FROM tenant_bank_accounts b
                 JOIN owner_tenants ot ON ot.owner_id = b.owner_id
                WHERE ot.tenant_id = t.id AND b.linked_account_id IS NOT NULL
                ORDER BY b.created_at DESC LIMIT 1),
              t.razorpay_linked_account_id
            ) AS razorpay_linked_account_id,
            t.daily_payout, t.own_razorpay
       FROM tenants t WHERE t.id=$1 AND t.status='active'`, [resolved.tenantId]
  ).catch(() => null)
  const linkedAccountId = row?.rows[0]?.razorpay_linked_account_id
  const dailyPayout = row?.rows[0]?.daily_payout === true
  const ownRazorpayFlag = row?.rows[0]?.own_razorpay === true

  // Reconcile the own_razorpay column against the keys that actually signed (see verify route):
  // fall to the money-safe branch on drift so a tenant is never left unpaid nor a bad transfer fired.
  const { isOwn } = await resolveRazorpayCreds(resolved.tenantId).catch(() => ({ isOwn: ownRazorpayFlag }))
  const ownRazorpay = ownRazorpayFlag && isOwn
  if (ownRazorpayFlag !== isOwn) {
    console.warn('[fireRouteTransfer:webhook] own_razorpay/creds mismatch', { tenantId: resolved.tenantId, orderRef: opts.orderRef, ownRazorpayFlag, isOwn })
  }

  if (ownRazorpay) {
    await recordTenantTransaction({
      tenantId: resolved.tenantId,
      orderRef: opts.orderRef,
      grossAmountInr: opts.totalAmountInr,
      gatewayTxnId: opts.paymentId,
    })
    return
  }

  if (!linkedAccountId) {
    await recordTenantTransaction({
      tenantId: resolved.tenantId,
      orderRef: opts.orderRef,
      grossAmountInr: opts.totalAmountInr,
      gatewayTxnId: opts.paymentId,
    })
    return
  }

  const result = await transferToLinkedAccount({
    paymentId: opts.paymentId,
    grossAmountPaise: Math.round(opts.totalAmountInr * 100),
    // Shipping is NOT withheld from the transfer — it is charged once from the prepaid wallet
    // at the real invoiced amount once the AWB is billed.
    linkedAccountId,
    orderId: opts.orderId,
    tenantSlug: resolved.slug,
    dailyPayout,
  })

  await recordTenantTransaction({
    tenantId: resolved.tenantId,
    orderRef: opts.orderRef,
    grossAmountInr: opts.totalAmountInr,
    gatewayTxnId: result.transferId || opts.paymentId,
    split: {
      tenantShareInr: result.amount / 100,
      platformCommissionInr: result.platformCommissionPaise / 100,
      gatewayFeeInr: (result.gatewayFeePaise + result.transferFeePaise) / 100,
    },
  })
}

async function handlePaymentCaptured(payment: any) {
  const razorpayOrderId = payment.order_id
  const razorpayPaymentId = payment.id

  // Wallet top-ups are not orders. The browser callback normally credits them, but if it never
  // fires (tab closed, network drop) the money is captured and the credit lost — this webhook is
  // the durable fallback. rechargeWallet is idempotent on external_ref, so the two paths racing
  // credit exactly once.
  if (payment?.notes?.purpose === 'wallet_topup') {
    const tenantId = (payment.notes.tenant_id ?? '').toString().trim()
    const amountInr = (Number(payment.amount) || 0) / 100
    if (tenantId && amountInr > 0) {
      const { rechargeWallet } = await import('@/lib/wallet')
      await rechargeWallet({
        tenantId,
        amountInr,
        note: `Razorpay top-up ${razorpayPaymentId}`,
        externalRef: razorpayPaymentId,
      }).catch(() => {})
    }
    return
  }

  const paymentRecord = await queryOne(
    `SELECT p.id as payment_id, p.order_id, p.status as payment_record_status,
            o.id as db_order_id, o.payment_status, o.order_number, o.total_amount, o.shipping_amount,
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

  let flippedToPaid = false
  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE orders SET payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )
    flippedToPaid = (upd.rowCount ?? 0) > 0

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
      await client.query('DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE', [paymentRecord.user_id])
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

  // Only the handler that actually flipped the order to paid moves money — the transfer API
  // is not idempotent, so gating on the atomic paid-flip is what prevents a double-transfer
  // when the browser return to /verify races this webhook.
  if (flippedToPaid) {
    fireRouteTransfer({
      paymentId: razorpayPaymentId,
      totalAmountInr: parseFloat(paymentRecord.total_amount),
      shippingAmountInr: parseFloat(paymentRecord.shipping_amount) || 0,
      orderId,
      orderRef: paymentRecord.order_number,
      payment,
    }).catch(() => {})
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
    `SELECT id, payment_status, user_id, order_number, total_amount, shipping_amount, customer_email, customer_name
     FROM orders WHERE payment_link_id = $1`,
    [linkId]
  )

  if (!order || order.payment_status === 'paid') return

  let flippedToPaid = false
  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE orders SET
        payment_status = 'paid',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        payment_link_status = 'paid',
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [order.id]
    )
    flippedToPaid = (upd.rowCount ?? 0) > 0

    await client.query(
      `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay_link', $2, $3, 'completed', $4)
       ON CONFLICT DO NOTHING`,
      [order.id, paymentLink.payments?.[0]?.payment_id || linkId, parseFloat(order.total_amount), JSON.stringify(paymentLink)]
    )

    if (order.user_id) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE', [order.user_id])
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

  const linkPaymentId = paymentLink.payments?.[0]?.payment_id
  if (flippedToPaid && linkPaymentId) {
    fireRouteTransfer({
      paymentId: linkPaymentId,
      totalAmountInr: parseFloat(order.total_amount),
      shippingAmountInr: parseFloat(order.shipping_amount) || 0,
      orderId: order.id,
      orderRef: order.order_number,
      payment: paymentLink,
    }).catch(() => {})
  }
}

async function handleQrCodeCredited(qrCode: any) {
  const qrId = qrCode?.id
  if (!qrId) return

  const order = await queryOne<{ id: string; payment_status: string; total_amount: string; shipping_amount: string; order_number: string }>(
    `SELECT id, payment_status, total_amount, shipping_amount, order_number FROM orders WHERE razorpay_qr_id = $1`,
    [qrId]
  )
  if (!order || order.payment_status === 'paid') return

  const upd = await query(
    `UPDATE orders SET payment_status = 'paid', updated_at = NOW()
     WHERE razorpay_qr_id = $1 AND payment_status != 'paid'`,
    [qrId]
  )
  const flippedToPaid = (upd.rowCount ?? 0) > 0
  const qrPaymentId = qrCode.payments?.[0]?.razorpay_payment_id
  await query(
    `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'razorpay_qr', $2, $3, 'completed', $4)
     ON CONFLICT DO NOTHING`,
    [order.id, qrPaymentId || qrId, parseFloat(order.total_amount), JSON.stringify(qrCode)]
  )

  if (flippedToPaid && qrPaymentId) {
    fireRouteTransfer({
      paymentId: qrPaymentId,
      totalAmountInr: parseFloat(order.total_amount),
      shippingAmountInr: parseFloat(order.shipping_amount) || 0,
      orderId: order.id,
      orderRef: order.order_number,
      payment: qrCode,
    }).catch(() => {})
  }
}

async function handlePaymentLinkExpired(paymentLink: any) {
  await queryOne(
    `UPDATE orders SET payment_link_status = 'expired', updated_at = NOW()
     WHERE payment_link_id = $1 AND payment_link_status = 'created'`,
    [paymentLink.id]
  )
}

// A Route transfer to a linked account has cleared its on_hold window and processed, so the split
// tenant_transactions row (whose gateway_txn_id is the trf_... id) advances captured -> settled.
// Own-account/gross-only rows never route through the platform, so they get no transfer.processed
// event here; their money settles on the tenant's own Razorpay account. Non-fatal bookkeeping.
async function handleTransferProcessed(transfer: any) {
  const transferId = (transfer?.id ?? '').toString().trim()
  if (!transferId || transfer?.status !== 'processed' || transfer?.on_hold === true) return
  await controlPlanePool().query(
    `UPDATE tenant_transactions SET status = 'settled'
     WHERE gateway_txn_id = $1 AND status = 'captured'`,
    [transferId]
  ).catch(() => {})
}

/**
 * A transfer was reversed — by our own refund paths, or from the Razorpay dashboard.
 * Marks the tenant transaction refunded so the billing view stops counting the reversed
 * share as tenant earnings. Idempotent: the WHERE clause no-ops once already refunded.
 */
async function handleTransferReversed(transfer: any) {
  const transferId = (transfer?.id ?? '').toString().trim()
  if (!transferId) return
  await controlPlanePool().query(
    `UPDATE tenant_transactions SET status = 'refunded'
     WHERE gateway_txn_id = $1 AND status <> 'refunded'`,
    [transferId]
  ).catch(() => {})
}

/**
 * A refund was issued — possibly from the Razorpay DASHBOARD, bypassing the app entirely.
 * In that case no reversal was attempted and nothing was recorded, so the tenant silently
 * keeps their share. Mark the payment refunded and record the shortfall as tenant debt for
 * the reconciliation to pick up.
 *
 * Refunds issued BY the app already recorded themselves; the status guard makes this a no-op
 * for those rather than double-counting.
 */
async function handleRefund(refund: any) {
  const paymentId = (refund?.payment_id ?? '').toString().trim()
  if (!paymentId) return

  const updated = await query(
    `UPDATE payments SET status = 'refunded', updated_at = NOW()
      WHERE transaction_id = $1 AND status <> 'refunded'
      RETURNING order_id`,
    [paymentId]
  ).catch(() => null)

  const orderId = updated?.rows?.[0]?.order_id
  if (!orderId) return // already recorded by the in-app refund path

  await query(
    `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
    [orderId]
  ).catch(() => {})

  const order = await queryOne<{ order_number: string }>(
    `SELECT order_number FROM orders WHERE id = $1`, [orderId]
  ).catch(() => null)
  if (!order?.order_number) return
  // Razorpay hits a fixed URL with no tenant host, so ALS is empty here — the tenant is carried
  // in the refund's own notes (copied from the payment), same as every other handler in this file.
  const tenant = await resolveWebhookTenantId(refund, order.order_number).catch(() => null)
  if (!tenant?.tenantId) return

  // Out-of-band refund: nothing reversed the tenant's share, so the whole amount is owed.
  const refundedInr = (Number(refund?.amount) || 0) / 100
  await recordRefundSettlement({
    tenantId: tenant.tenantId,
    orderRef: order.order_number,
    refundedInr,
    reversedInr: 0,
    unrecoveredInr: refundedInr,
    note: 'refunded outside the app (dashboard)',
  }).catch(() => {})
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
        codFeeAmount: draft.codFeeAmount,
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
        codFeeAmount: draft.codFeeAmount,
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

  // The intent claim above (committed=false → true, RETURNING) already elected a single winner,
  // so this transfer fires exactly once per payment.
  fireRouteTransfer({
    paymentId: razorpayPaymentId,
    totalAmountInr: parseFloat(created.total_amount),
    shippingAmountInr: draft.shippingAmount || 0,
    orderId: created.id,
    orderRef: created.order_number,
    payment,
  }).catch(() => {})
}
