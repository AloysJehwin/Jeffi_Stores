import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { applyCapturedPayment, applyLinkPayment, applyQrPayment, recordPaymentDetails } from '@/lib/payments/capture'
import { runInTenant } from '@/lib/payments/webhook-tenant'
import { inPaymentStore, storeFor, type EventContext } from './context'

/** Returns what happened to the payment (a CaptureOutcome, or 'wallet' for a top-up). */
export async function onPaymentCaptured(payment: any, ctx: EventContext): Promise<string> {
  if (!payment?.id) return 'unmatched'
  // Wallet top-ups are not orders. The browser callback normally credits them; this is the durable
  // fallback. rechargeWallet is idempotent on external_ref, so the two racing credit once.
  if (payment.notes?.purpose === 'wallet_topup') {
    if (ctx.source === 'platform') await creditWalletTopup(payment)
    return 'wallet'
  }
  return inPaymentStore(ctx, payment, async store => {
    const out = await applyCapturedPayment(payment, store)
    if (out !== 'unmatched') await details(payment, ctx)
    return out
  })
}

// Verify usually wins the race, so the details are filled even when the order was already paid.
const details = (payment: any, ctx: EventContext) =>
  recordPaymentDetails(payment, { account: ctx.source, capturedAt: new Date() }).catch(() => {})

async function creditWalletTopup(payment: any) {
  const tenantId = (payment.notes.tenant_id ?? '').toString().trim()
  if (!tenantId || !(Number(payment.amount) > 0)) return
  // The order's notes carry credit_inr (the payment's may not): credit excludes the GST.
  const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
  const order = payment.order_id ? await getRazorpayInstance().orders.fetch(payment.order_id).catch(() => null) : null
  const { creditTopup } = await import('@/lib/billing/topup')
  await creditTopup({ tenantId, paymentId: payment.id, paidPaise: Number(payment.amount), notes: (order?.notes as any) ?? payment.notes }).catch(() => {})
}

export async function onPaymentFailed(payment: any, ctx: EventContext) {
  if (!payment?.order_id) return
  await inPaymentStore(ctx, payment, () => markPaymentFailed(payment))
}

async function markPaymentFailed(payment: any) {
  const record = await queryOne(`SELECT p.order_id FROM payments p WHERE p.gateway_response->>'razorpay_order_id' = $1 LIMIT 1`, [
    payment.order_id,
  ])
  if (!record) return 'unmatched'

  await queryOne(
    `UPDATE payments SET status = 'failed', gateway_response = $1, updated_at = NOW(),
            error_code = $3, error_reason = $4, error_source = $5, error_step = $6, error_description = $7, gateway_method = COALESCE(gateway_method, $8)
     WHERE order_id = $2 AND payment_gateway = 'razorpay' AND status = 'pending'`,
    [
      JSON.stringify(payment),
      record.order_id,
      payment.error_code ?? null,
      payment.error_reason ?? null,
      payment.error_source ?? null,
      payment.error_step ?? null,
      payment.error_description ?? null,
      payment.method ?? null,
    ]
  )
  await queryOne(`UPDATE orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1 AND payment_status = 'unpaid'`, [
    record.order_id,
  ])

  const order = await queryOne<{ user_id: string | null; order_number: string; total_amount: string }>(
    `SELECT user_id, order_number, total_amount FROM orders WHERE id = $1`,
    [record.order_id]
  )
  if (order?.user_id) {
    createAutoTask({
      userId: order.user_id,
      sourceKind: 'contact_failed_payment',
      sourceRefId: record.order_id,
      title: `Reach out about failed payment on #${order.order_number}`,
      description: `Razorpay reported payment.failed for ₹${order.total_amount}.`,
      priority: 'medium',
      dueInDays: 1,
    }).catch(() => {})
  }
  return 'failed'
}

// Links and QR codes are made by us, so their notes name the store.
export async function onPaymentLinkPaid(link: any, payment: any, ctx: EventContext) {
  const store = await storeFor(ctx, link)
  if (!store) return
  await runInTenant(store, async () => {
    if ((await applyLinkPayment(link, payment, store)) !== 'unmatched' && payment?.id) await details(payment, ctx)
  })
}

export async function onPaymentLinkExpired(link: any, ctx: EventContext) {
  const store = await storeFor(ctx, link)
  if (!store) return
  await runInTenant(store, () =>
    queryOne(`UPDATE orders SET payment_link_status = 'expired', updated_at = NOW() WHERE payment_link_id = $1 AND payment_link_status = 'created'`, [
      link?.id,
    ])
  )
}

export async function onQrCodeCredited(qr: any, payment: any, ctx: EventContext) {
  if (!qr?.id) return
  const store = await storeFor(ctx, qr)
  if (!store) return
  await runInTenant(store, async () => {
    if ((await applyQrPayment(qr, payment, store)) !== 'unmatched' && payment?.id) await details(payment, ctx)
  })
}
