import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { queryMany } from '@/lib/db'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function GET(request: NextRequest) {
  try {
    const token = cookies().get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let userId: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const transactions = await queryMany(`
      SELECT
        p.id, p.transaction_id, p.payment_method, p.payment_gateway,
        p.amount, p.status, p.created_at, p.updated_at,
        o.id AS order_id, o.order_number
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.user_id = $1
      ORDER BY p.created_at DESC
    `, [userId])

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
    })
  } catch (error) {
    console.error('Error in transactions API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
