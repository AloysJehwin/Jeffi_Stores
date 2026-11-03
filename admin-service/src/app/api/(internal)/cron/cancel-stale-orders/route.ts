import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { cancelOrder } from '@/lib/orders/orders'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Integer-sanitised for safe SQL interval interpolation.
    const staleWindowMinutes = Math.max(1, Math.round((await getBusinessValues()).orderAutoCancelMinutes))
    const stale = await queryMany<{
      id: string
      order_number: string
      order_type: string
      created_at: string
      rzp_order_id: string | null
      payment_link_id: string | null
      razorpay_qr_id: string | null
    }>(
      `SELECT id, order_number, order_type, created_at, payment_link_id, razorpay_qr_id,
              (SELECT p.gateway_response->>'razorpay_order_id' FROM payments p
                WHERE p.order_id = orders.id AND p.payment_gateway = 'razorpay' AND p.gateway_response->>'razorpay_order_id' IS NOT NULL
                ORDER BY p.created_at DESC LIMIT 1) AS rzp_order_id
       FROM orders
       WHERE status = 'pending'
         AND payment_status IN ('unpaid', 'failed')
         AND payment_mode IS DISTINCT FROM 'cod'
         AND source IS DISTINCT FROM 'amazon'
         AND created_at < NOW() - INTERVAL '${staleWindowMinutes} minutes'
       ORDER BY created_at
       LIMIT 100`
    )

    const results: Array<{ orderId: string; orderNumber: string; ok: boolean; reason?: string }> = []

    for (const order of stale) {
      // A lost webhook can leave a paid order looking unpaid: ask Razorpay before cancelling.
      if (order.rzp_order_id || order.payment_link_id || order.razorpay_qr_id) {
        const { razorpayPaidBeforeCancel } = await import('@/lib/payments/rzp-sweep')
        const state = await razorpayPaidBeforeCancel(order)
        if (state === 'paid') {
          results.push({ orderId: order.id, orderNumber: order.order_number, ok: false, reason: 'paid_at_razorpay' })
          continue
        }
        // Razorpay unreachable: wait for it, up to a day.
        if (state === 'unknown' && Date.now() - new Date(order.created_at).getTime() < 24 * 3600 * 1000) continue
      }
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
      failed: results.filter(r => !r.ok && r.reason !== 'paid_at_razorpay').length,
      paid: results.filter(r => r.reason === 'paid_at_razorpay').length,
      results,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
