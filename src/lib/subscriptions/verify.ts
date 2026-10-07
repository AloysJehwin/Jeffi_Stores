import 'server-only'
import crypto from 'crypto'
import { queryOne } from '@/lib/shared/db'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { applySubscriptionState, commitCycle, unixToDate } from './cycle'
import { razorpayForSubscription } from './service'
import { SubscriptionError, type SubscriptionRow } from './types'

export function subscriptionSignature(keySecret: string, paymentId: string, subscriptionId: string): string {
  return crypto.createHmac('sha256', keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

export interface VerifyInput {
  userId: string
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

/** Checkout return: verify the signature, commit the first cycle if captured, sync state. */
export async function verifySubscriptionPayment(input: VerifyInput) {
  const sub = await queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1 AND user_id = $2`,
    [input.razorpay_subscription_id, input.userId]
  )
  if (!sub) throw new SubscriptionError('Subscription not found', 404)

  const { instance, keySecret } = await razorpayForSubscription(sub)
  const expected = subscriptionSignature(keySecret, input.razorpay_payment_id, input.razorpay_subscription_id)
  if (!keySecret || !safeEqual(expected, input.razorpay_signature)) {
    throw new SubscriptionError('Invalid payment signature')
  }

  const [entity, payment] = await Promise.all([
    instance.subscriptions.fetch(input.razorpay_subscription_id),
    instance.payments.fetch(input.razorpay_payment_id),
  ])

  let orderId: string | null = null
  let orderNumber: string | null = null
  if (payment?.status === 'captured') {
    const t = await resolveTenant()
    const res = await commitCycle({
      subscriptionId: sub.id,
      paymentId: input.razorpay_payment_id,
      invoiceId: payment.invoice_id ?? null,
      gatewayOrderId: payment.order_id ?? null,
      amountPaise: Number(payment.amount) || 0,
      paidCount: Number(entity?.paid_count) || null,
      currentStart: unixToDate(entity?.current_start),
      currentEnd: unixToDate(entity?.current_end),
      tenant: t ? { tenantId: t.tenantId, slug: t.slug } : null,
    })
    orderId = res.orderId
    orderNumber = res.orderNumber
  }

  const { row } = await applySubscriptionState(sub.id, entity?.status ?? null, entity)
  return { localId: sub.id, status: row.status, orderId, orderNumber }
}
