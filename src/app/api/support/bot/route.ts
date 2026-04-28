import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

function getBotReply(msg: string, orders: any[]): { reply: string } {
  const m = msg.toLowerCase()
  const latest = orders[0]

  if (m.includes('track') || m.includes('shipping') || m.includes('shipped')) {
    if (!latest) return { reply: "You don't have any orders yet." }
    if (latest.tracking_number) {
      return { reply: `Your order #${latest.order_number} has tracking number: ${latest.tracking_number}` }
    }
    if (latest.status === 'shipped') {
      return { reply: `Your order #${latest.order_number} is shipped. Tracking details will be updated shortly.` }
    }
    return { reply: `Your latest order #${latest.order_number} status is "${latest.status}". Tracking is available once shipped.` }
  }

  if (m.includes('payment') || m.includes('paid') || m.includes('invoice')) {
    if (!latest) return { reply: "You don't have any orders yet." }
    return { reply: `Your latest order #${latest.order_number} payment status is "${latest.payment_status}". Total: ₹${Number(latest.total_amount).toLocaleString('en-IN')}.` }
  }

  if (m.includes('cancel')) {
    return { reply: "To request a cancellation, go to My Account → Orders → select the order → Request Cancellation. Our team will review it within 24 hours." }
  }

  if (m.includes('refund')) {
    return { reply: "Refunds are processed within 5-7 business days after a cancellation is approved. The amount is credited back to the original payment method." }
  }

  if (m.includes('order') || m.includes('status') || m.includes('latest') || m.includes('recent')) {
    if (!latest) return { reply: "You don't have any orders yet. Browse our products and place your first order!" }
    return {
      reply: `Your latest order is #${latest.order_number} placed on ${new Date(latest.created_at).toLocaleDateString('en-IN')}.\nStatus: ${latest.status}\nPayment: ${latest.payment_status}\nTotal: ₹${Number(latest.total_amount).toLocaleString('en-IN')}`,
    }
  }

  if (m.includes('return') || m.includes('exchange')) {
    return { reply: "We currently don't support direct returns through the app. Please contact our support team for return requests." }
  }

  if (m.includes('delivery') || m.includes('deliver') || m.includes('arrive')) {
    return { reply: "Delivery typically takes 3-7 business days depending on your location. Express delivery is available for select pincodes." }
  }

  if (m.includes('hello') || m.includes('hi') || m.includes('hey')) {
    return { reply: "Hello! I'm the Jeffi Stores support bot. I can help you with order status, payment info, shipping, cancellations, and more. What do you need help with?" }
  }

  return {
    reply: "I'm not sure I understood that. Try asking about your order status, payment, shipping, or cancellation. Or click \"Connect to Support Agent\" to chat with our team.",
  }
}

export async function GET(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) {
    return NextResponse.json({ reply: "Your session has expired. Please log in again to use support chat." })
  }

  const msg = request.nextUrl.searchParams.get('msg') || ''
  if (!msg.trim()) {
    return NextResponse.json({ reply: "Please select a topic to get started." })
  }

  try {
    const orders = await queryMany(
      `SELECT order_number, status, payment_status, total_amount, tracking_number, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [authUser.userId]
    )
    const { reply } = getBotReply(msg, orders)
    return NextResponse.json({ reply })
  } catch {
    return NextResponse.json({ reply: "I'm having trouble fetching your data right now. Please try again or connect to a support agent." })
  }
}
