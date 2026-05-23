import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendAdminContactEmail } from '@/lib/email'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { subject, body } = await request.json()
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  const order = await queryOne<{ id: string; order_number: string; customer_name: string; customer_email: string; users?: { email: string; first_name: string; last_name: string } }>(
    `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
       json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = $1`,
    [params.id]
  )

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const email = order.users?.email || order.customer_email
  const name = order.users?.first_name
    ? `${order.users.first_name} ${order.users.last_name || ''}`.trim()
    : order.customer_name

  if (!email) return NextResponse.json({ error: 'No customer email for this order' }, { status: 400 })

  const result = await sendAdminContactEmail(email, name, subject.trim(), body.trim())

  if (!result.success) {
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
