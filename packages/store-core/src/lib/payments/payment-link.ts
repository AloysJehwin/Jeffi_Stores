import 'server-only'
import { queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { orderUrlById } from '@/lib/shared/customer-links'

// A Razorpay payment link for an unpaid order's total; a live one is reused.

export class PaymentLinkError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export interface PaymentLink {
  paymentLinkId: string
  paymentLinkUrl: string
  expiresAt?: string
  alreadyExists?: boolean
}

/** notify: Razorpay also texts/emails the link (off when our own reply already carries it). */
export async function createOrderPaymentLink(orderId: string, expiryHours = 48, notify = true): Promise<PaymentLink> {
  const order = await queryOne<any>(
    `SELECT id, order_number, total_amount, customer_name, customer_email, customer_phone, payment_status,
            payment_link_id, payment_link_status, payment_link_url
       FROM orders WHERE id = $1`,
    [orderId]
  )
  if (!order) throw new PaymentLinkError('Order not found', 404)
  if (order.payment_status === 'paid') throw new PaymentLinkError('Order already paid', 409)

  // Collect on the tenant's own Razorpay account when they use one, else the platform account —
  // the notes carry the tenant so the (host-less) webhook can attribute the sale for billing.
  const tenant = await resolveRequestTenant()
  const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
  const rzp = instance as any

  if (order.payment_link_id && order.payment_link_status === 'created') {
    const existing = await rzp.paymentLink.fetch(order.payment_link_id)
    if (existing.status === 'created') return { paymentLinkId: order.payment_link_id, paymentLinkUrl: order.payment_link_url ?? existing.short_url, alreadyExists: true }
  }

  const expiresAt = Math.floor(Date.now() / 1000) + expiryHours * 60 * 60
  // After paying, Razorpay sends the customer here. The order page shows the paid state once the
  // payment_link.paid webhook settles it; there is no separate callback route to land on.
  const orderPage = await orderUrlById(orderId)
  const link = await rzp.paymentLink.create({
    amount: Math.round(parseFloat(order.total_amount) * 100),
    currency: 'INR',
    accept_partial: false,
    description: `Payment for Order #${order.order_number}`,
    customer: { name: order.customer_name, email: order.customer_email, contact: order.customer_phone || '' },
    notify: { sms: notify && !!order.customer_phone, email: notify && !!order.customer_email },
    reminder_enable: true,
    notes: {
      order_id: orderId,
      order_number: order.order_number,
      ...(tenant?.tenantId ? { tenant_id: tenant.tenantId } : {}),
      ...(tenant?.slug ? { tenant_slug: tenant.slug } : {}),
    },
    expire_by: expiresAt,
    callback_url: orderPage,
    callback_method: 'get',
  })

  await queryOne(
    `UPDATE orders SET payment_link_id = $1, payment_link_url = $2, payment_link_status = 'created', payment_link_expires_at = $3 WHERE id = $4`,
    [link.id, link.short_url, new Date(expiresAt * 1000), orderId]
  )
  return { paymentLinkId: link.id, paymentLinkUrl: link.short_url, expiresAt: new Date(expiresAt * 1000).toISOString() }
}
