import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { getRazorpayInstance } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { orderId, expiryHours = 48 } = body

    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

    const order = await queryOne(
      'SELECT id, order_number, total_amount, customer_name, customer_email, customer_phone, payment_status, payment_link_id FROM orders WHERE id = $1',
      [orderId]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.payment_status === 'paid') return NextResponse.json({ error: 'Order already paid' }, { status: 409 })

    if (order.payment_link_id && order.payment_link_status === 'created') {
      const rzp = getRazorpayInstance() as any
      const existing = await rzp.paymentLink.fetch(order.payment_link_id)
      if (existing.status === 'created') {
        return NextResponse.json({
          paymentLinkId: order.payment_link_id,
          paymentLinkUrl: order.payment_link_url,
          alreadyExists: true,
        })
      }
    }

    const rzp = getRazorpayInstance() as any
    const expiresAt = Math.floor(Date.now() / 1000) + expiryHours * 60 * 60

    const link = await rzp.paymentLink.create({
      amount: Math.round(parseFloat(order.total_amount) * 100),
      currency: 'INR',
      accept_partial: false,
      description: `Payment for Order #${order.order_number}`,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        contact: order.customer_phone || '',
      },
      notify: {
        sms: !!order.customer_phone,
        email: !!order.customer_email,
      },
      reminder_enable: true,
      notes: { order_id: orderId, order_number: order.order_number },
      expire_by: expiresAt,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/razorpay/payment-link/callback`,
      callback_method: 'get',
    })

    await queryOne(
      `UPDATE orders SET
        payment_link_id = $1,
        payment_link_url = $2,
        payment_link_status = 'created',
        payment_link_expires_at = $3
       WHERE id = $4`,
      [link.id, link.short_url, new Date(expiresAt * 1000), orderId]
    )

    return NextResponse.json({
      paymentLinkId: link.id,
      paymentLinkUrl: link.short_url,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
