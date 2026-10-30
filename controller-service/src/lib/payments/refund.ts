import { randomUUID } from 'crypto'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { RAZORPAY_ONLY_METHODS, type ExternalRefund, type ExternalRefundEntry } from '@/lib/payments/external-refund'

interface RefundOrderLike {
  status: string
  total_amount: number | string
}

interface ReturnRequestLike {
  type?: string | null
  items?: Array<{ refund_amount: number | string }> | null
}

export async function computeRefundableAmount(
  order: RefundOrderLike,
  returnRequest: ReturnRequestLike | null
): Promise<number> {
  const total = parseFloat(String(order.total_amount)) || 0
  const isReturn = order.status === 'returned'

  if (!isReturn) {
    return Math.max(0, Math.round(total * 100) / 100)
  }

  const charge = (await getBusinessValues()).returnStandardCharge
  const items = Array.isArray(returnRequest?.items) ? returnRequest!.items! : []
  const returnedValue =
    items.length > 0 ? items.reduce((sum, i) => sum + (parseFloat(String(i.refund_amount)) || 0), 0) : total

  return Math.max(0, Math.round((returnedValue - charge) * 100) / 100)
}

const parseGw = (g: unknown): Record<string, any> => (typeof g === 'string' ? JSON.parse(g) : (g as any) || {})

/** What a captured payment can still refund: its amount minus earlier partial refunds. */
export function refundCapacity(p: { amount: number | string; gateway_response: unknown }): number {
  const gw = parseGw(p.gateway_response)
  const partial = (Array.isArray(gw.partial_refunds) ? gw.partial_refunds : []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0)
  const legacy = gw.variantChangeRefund?.amount ? Number(gw.variantChangeRefund.amount) / 100 : 0
  return Math.max(0, Math.round(((Number(p.amount) || 0) - partial - legacy) * 100) / 100)
}

/**
 * Partially refund `amount` across the order's completed Razorpay payments (the original charge and any
 * top-ups), on the tenant's own keys when connected else the platform's, with the Route clawback per refund.
 * Payments stay 'completed'; each refund is appended to gateway_response.partial_refunds.
 */
export async function refundAcrossPayments(opts: {
  orderId: string
  amount: number
  orderRef: string
  purpose: string
  tenantId?: string | null
}): Promise<{ refunded: number; refunds: Array<{ id: string; amount: number; paymentId: string }> }> {
  const { queryMany, query } = await import('@/lib/shared/db')
  const { getRazorpayInstanceFor } = await import('@/lib/payments/razorpay')
  const { applyRouteRefund } = await import('@/lib/payments/route-settlement')
  const payments = await queryMany<{ id: string; transaction_id: string | null; amount: string; gateway_response: unknown }>(
    `SELECT id, transaction_id, amount, gateway_response FROM payments
      WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed' AND transaction_id IS NOT NULL
      ORDER BY created_at`,
    [opts.orderId]
  )
  const { instance } = await getRazorpayInstanceFor(opts.tenantId ?? undefined)
  const refunds: Array<{ id: string; amount: number; paymentId: string }> = []
  let remaining = Math.round(opts.amount * 100) / 100
  for (const p of payments) {
    if (remaining <= 0) break
    const take = Math.min(refundCapacity(p), remaining)
    if (!(take > 0)) continue
    const paise = Math.round(take * 100)
    const refund = await instance.payments.refund(p.transaction_id!, { amount: paise, notes: { purpose: opts.purpose } })
    await import('@/lib/payments/refund-records')
      .then(m => m.recordRefund({ refund, paymentRowId: p.id, orderId: opts.orderId, purpose: opts.purpose }))
      .catch(() => {})
    const outcome = await applyRouteRefund({ tenantId: opts.tenantId ?? undefined, paymentId: p.transaction_id!, refundId: refund.id, refundPaise: paise, orderRef: opts.orderRef })
    if (outcome.unrecoveredPaise > 0) console.error(`[refund] transfer reversal INCOMPLETE order=${opts.orderId} payment=${p.transaction_id} unrecoveredPaise=${outcome.unrecoveredPaise}`)
    const gw = parseGw(p.gateway_response)
    await query(`UPDATE payments SET gateway_response = $1, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify({ ...gw, partial_refunds: [...(gw.partial_refunds ?? []), { id: refund.id, amount: take, purpose: opts.purpose, at: new Date().toISOString() }] }),
      p.id,
    ])
    refunds.push({ id: refund.id, amount: take, paymentId: p.transaction_id! })
    remaining = Math.round((remaining - take) * 100) / 100
  }
  // The order's total already reflects the change; keep the Google Ads conversion value in step.
  const { queueAdsConversion } = await import('@/lib/google-ads/conversions/queue')
  await queueAdsConversion(opts.orderId)
  if (remaining > 0.01) throw Object.assign(new Error(`Only ₹${(opts.amount - remaining).toFixed(2)} of ₹${opts.amount.toFixed(2)} could be refunded — no payment has enough left`), { refunds })
  return { refunded: Math.round((opts.amount - remaining) * 100) / 100, refunds }
}

/**
 * Record a refund that reached the customer outside the in-app Razorpay call (a dispute, the Razorpay
 * dashboard, bank transfer, cash…). `full` marks the completed payments refunded; otherwise `amount` is
 * booked as a partial refund against what they can still cover. With no payment row (COD, cash, marked
 * paid by hand) a 'manual' row carries it. Disputes and dashboard refunds also settle the Route share.
 */
export async function recordExternalRefund(opts: {
  orderId: string
  amount: number
  full: boolean
  refund: ExternalRefund
  purpose: string
  orderRef: string
  actorId?: string | null
  tenantId?: string | null
  /** Only this Razorpay payment (a dispute names one); default every completed payment. */
  transactionId?: string
}): Promise<void> {
  const { queryMany, query } = await import('@/lib/shared/db')
  const { applyRouteRefund } = await import('@/lib/payments/route-settlement')
  const amount = Math.round(opts.amount * 100) / 100
  const id = `ext_${randomUUID().slice(0, 8)}`
  const entry = (take: number): ExternalRefundEntry => ({
    ...opts.refund,
    amount: take,
    purpose: opts.purpose,
    at: new Date().toISOString(),
    by: opts.actorId ?? null,
  })
  const payments = await queryMany<{ id: string; transaction_id: string | null; payment_gateway: string | null; amount: string; gateway_response: unknown }>(
    `SELECT id, transaction_id, payment_gateway, amount, gateway_response FROM payments
      WHERE order_id = $1 AND status = 'completed' AND ($2::text IS NULL OR transaction_id = $2)
      ORDER BY created_at`,
    [opts.orderId, opts.transactionId ?? null]
  )
  if (!payments.length) {
    await query(
      `INSERT INTO payments (order_id, payment_method, payment_gateway, amount, status, gateway_response)
       VALUES ($1, $2, 'manual', $3, 'refunded', $4)`,
      [opts.orderId, opts.refund.method, amount.toFixed(2), JSON.stringify({ purpose: 'external_refund', external_refund: entry(amount) })]
    )
    return
  }
  const settlesRoute = RAZORPAY_ONLY_METHODS.includes(opts.refund.method)
  const ref = opts.refund.reference
  let remaining = amount
  for (const p of payments) {
    const take = Math.min(refundCapacity(p), remaining)
    remaining = Math.round((remaining - take) * 100) / 100
    if (!opts.full && !(take > 0)) continue
    const gw = parseGw(p.gateway_response)
    const next = opts.full
      ? { ...gw, ...(take > 0 ? { external_refund: entry(take) } : {}) }
      : { ...gw, partial_refunds: [...(gw.partial_refunds ?? []), { id, ...entry(take) }] }
    await query(`UPDATE payments SET ${opts.full ? "status = 'refunded', " : ''}gateway_response = $1, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify(next),
      p.id,
    ])
    if (settlesRoute && take > 0 && p.payment_gateway === 'razorpay' && p.transaction_id) {
      await applyRouteRefund({
        tenantId: opts.tenantId ?? undefined,
        paymentId: p.transaction_id,
        refundId: ref && /^(rfnd|disp)_/.test(ref) ? ref : id,
        refundPaise: Math.round(take * 100),
        orderRef: opts.orderRef,
      })
    }
  }
}

/** What the order's completed payments can still refund; null when it has none (COD, cash, marked paid by hand). */
export async function externalRefundCeiling(orderId: string): Promise<number | null> {
  const { queryMany } = await import('@/lib/shared/db')
  const rows = await queryMany<{ amount: string; gateway_response: unknown }>(
    `SELECT amount, gateway_response FROM payments WHERE order_id = $1 AND status = 'completed'`,
    [orderId]
  )
  if (!rows.length) return null
  return Math.round(rows.reduce((s, p) => s + refundCapacity(p), 0) * 100) / 100
}
