import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendAdminContactEmail } from '@/lib/email'
import { parseBody, zNonEmpty } from '@/lib/validate'
import { buildVarMap, substituteVars } from '@/lib/template-vars'

const Schema = z.object({
  subject: zNonEmpty,
  body: zNonEmpty,
  isHtml: z.boolean().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = parseBody(Schema, raw)
  if (!parsed.ok) return parsed.response
  const { subject, body, isHtml } = parsed.data

  const order = await queryOne<{ id: string; order_number: string; customer_name: string; customer_email: string; users?: { email: string; first_name: string; last_name: string } }>(
    `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
       json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = $1`,
    [id]
  )

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const email = order.users?.email || order.customer_email
  const firstName = order.users?.first_name || (order.customer_name?.split(' ')[0] ?? '')
  const lastName = order.users?.last_name || ''
  const name = order.users?.first_name
    ? `${order.users.first_name} ${order.users.last_name || ''}`.trim()
    : order.customer_name

  if (!email) return NextResponse.json({ error: 'No customer email for this order' }, { status: 400 })

  const vars = {
    ...buildVarMap({ recipient: { email, first_name: firstName, last_name: lastName } }),
    order_number: order.order_number || '',
  }
  const finalSubject = substituteVars(subject.trim(), vars)
  const finalBody = substituteVars(body.trim(), vars)

  const result = await sendAdminContactEmail(email, name, finalSubject, finalBody, { isHtml: !!isHtml })

  if (!result.success) {
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
