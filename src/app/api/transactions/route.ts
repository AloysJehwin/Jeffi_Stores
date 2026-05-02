import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryCount } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

const PAGE_SIZE = 10

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.userId

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = PAGE_SIZE
    const offset = (page - 1) * limit

    const [transactions, total] = await Promise.all([
      queryMany(`
        SELECT
          p.id, p.transaction_id, p.payment_method, p.payment_gateway,
          p.amount, p.status, p.created_at, p.updated_at,
          o.id AS order_id, o.order_number
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.user_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]),
      queryCount(`SELECT COUNT(*) FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.user_id = $1`, [userId]),
    ])

    return NextResponse.json({
      transactions: (transactions || []).map((t: any) => ({
        id: t.id,
        transactionId: t.transaction_id,
        paymentMethod: t.payment_method,
        paymentGateway: t.payment_gateway,
        amount: parseFloat(t.amount),
        status: t.status,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        orderId: t.order_id,
        orderNumber: t.order_number,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
