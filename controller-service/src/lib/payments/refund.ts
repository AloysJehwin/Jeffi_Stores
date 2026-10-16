import { getBusinessValues } from '@/lib/catalog/site-controls'

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
