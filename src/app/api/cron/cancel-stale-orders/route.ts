import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { cancelOrder } from '@/lib/orders'

const STALE_PAYMENT_WINDOW_MINUTES = 10

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stale = await queryMany<{ id: string; order_number: string; order_type: string }>(
      `SELECT id, order_number, order_type
       FROM orders
       WHERE status = 'pending'
         AND payment_status IN ('unpaid', 'failed')
         AND payment_mode IS DISTINCT FROM 'cod'
         AND created_at < NOW() - INTERVAL '${STALE_PAYMENT_WINDOW_MINUTES} minutes'
       ORDER BY created_at
       LIMIT 100`
    )

    const results: Array<{ orderId: string; orderNumber: string; ok: boolean; reason?: string }> = []

    for (const order of stale) {
      const result = await cancelOrder(order.id, {
        reason: 'auto_cancel_unpaid',
        restoreToCart: order.order_type !== 'direct',
      })

      if (result.success) {
        results.push({ orderId: order.id, orderNumber: order.order_number, ok: true })
      } else {
        results.push({
          orderId: order.id,
          orderNumber: order.order_number,
          ok: false,
          reason: result.error,
        })
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      cancelled: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
