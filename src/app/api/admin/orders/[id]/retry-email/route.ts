import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { sendPaymentRetryEmail } from '@/lib/email'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await queryOne<{
    id: string
    order_number: string
    customer_email: string
    customer_name: string
    payment_status: string
    total_amount: number
    created_at: string
  }>(
    'SELECT id, order_number, customer_email, customer_name, payment_status, total_amount, created_at FROM orders WHERE id = $1',
    [params.id]
  )

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (order.payment_status !== 'failed') {
    return NextResponse.json({ error: 'Order payment status is not failed' }, { status: 400 })
  }

  const ageHours = (Date.now() - new Date(order.created_at).getTime()) / 3600000
  if (ageHours > 24) {
    return NextResponse.json({ error: 'Order is older than 24 hours' }, { status: 400 })
  }

  const result = await sendPaymentRetryEmail(
    order.customer_email,
    order.customer_name,
    order.order_number,
    Number(order.total_amount),
  )

  if (!result.success) {
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
