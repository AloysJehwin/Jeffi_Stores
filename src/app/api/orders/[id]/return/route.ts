import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { query, queryOne, queryMany } from '@/lib/db'
import { sendReturnStatusEmail } from '@/lib/email'

const RETURN_WINDOW_DAYS = 7

const REASONS = ['defective', 'wrong_item', 'not_as_described', 'damaged', 'other']

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const returnRequest = await queryOne(
      `SELECT * FROM return_requests WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [params.id, authUser.userId]
    )

    return NextResponse.json({ returnRequest: returnRequest || null })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { type, reason, description } = await request.json()

    if (!['refund', 'replacement'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be refund or replacement.' }, { status: 400 })
    }
    if (!REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason.' }, { status: 400 })
    }

    const order = await queryOne(
`SELECT o.id, o.status, o.order_number, o.delivered_at, o.updated_at, o.user_id,
              o.customer_name, o.customer_email,
              u.first_name, u.last_name, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [params.id, authUser.userId]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (order.status !== 'delivered') {
      return NextResponse.json({ error: 'Only delivered orders can be returned.' }, { status: 400 })
    }

const deliveredAt = new Date(order.delivered_at || order.updated_at)
    const windowExpiry = new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    if (new Date() > windowExpiry) {
      return NextResponse.json({ error: `Return window has closed. Returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery.` }, { status: 400 })
    }

    const existing = await queryOne(
      `SELECT id FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected', 'completed')`,
      [params.id]
    )
    if (existing) {
      return NextResponse.json({ error: 'A return request already exists for this order.' }, { status: 400 })
    }

    const returnRequest = await queryOne(
      `INSERT INTO return_requests (order_id, user_id, type, reason, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.id, authUser.userId, type, reason, description || null]
    )

    await query(
      `UPDATE orders SET status = 'return_requested', updated_at = NOW() WHERE id = $1`,
      [params.id]
    )

    const customerName = `${order.first_name || ''} ${order.last_name || ''}`.trim() || order.customer_name || 'Customer'
    const customerEmail = order.user_email || order.customer_email

    const admins = await queryMany(
      `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true AND u.email IS NOT NULL`,
      []
    )
    const adminEmails = admins.map((a: any) => a.email)
    const fallback = process.env.ADMIN_EMAIL
    if (fallback && !adminEmails.includes(fallback)) adminEmails.push(fallback)

    if (adminEmails.length > 0) {
      await sendReturnStatusEmail(adminEmails, customerName, order.order_number, params.id, 'requested_admin', {
        returnType: type,
        reason,
      })
    }

    return NextResponse.json({ returnRequest }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create return request' }, { status: 500 })
  }
}
