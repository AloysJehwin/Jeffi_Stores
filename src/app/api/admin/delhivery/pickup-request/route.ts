import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, query } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY
const PICKUP_LOCATION = process.env.DELHIVERY_PICKUP_LOCATION || 'Jeffi Stores'
const DELHIVERY_PICKUP_URL = 'https://track.delhivery.com/fm/request/new/'

const EXCLUDE_STATUSES = ['shipped', 'delivered', 'cancelled', 'returned', 'return_requested', 'return_approved', 'return_received', 'return_rejected']

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const orders = await queryMany(`
      SELECT o.id, o.order_number, o.awb_number, o.status, o.created_at,
             o.customer_name, sa.city, sa.state, sa.postal_code
      FROM orders o
      LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
      WHERE o.awb_number IS NOT NULL
        AND o.payment_status = 'paid'
        AND o.status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
        AND o.created_at >= $1
      ORDER BY o.created_at DESC
    `, [since, ...EXCLUDE_STATUSES])

    return NextResponse.json({ orders: orders || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const body = await request.json()
    const { orderIds, pickupDate } = body

    if (!orderIds?.length) return NextResponse.json({ error: 'No orders selected' }, { status: 400 })
    if (!pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
      return NextResponse.json({ error: 'Invalid pickup date' }, { status: 400 })
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const eligible = await queryMany(`
      SELECT id, awb_number FROM orders
      WHERE id = ANY($1::uuid[])
        AND awb_number IS NOT NULL
        AND payment_status = 'paid'
        AND status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 2}`).join(', ')})
        AND created_at >= $${EXCLUDE_STATUSES.length + 2}
    `, [orderIds, ...EXCLUDE_STATUSES, since])

    if (!eligible || eligible.length === 0) {
      return NextResponse.json({ error: 'No eligible orders found (must have AWB, be paid, not yet shipped, and placed within 24 hours)' }, { status: 422 })
    }

    const params = new URLSearchParams()
    params.append('pickup_time', '14:00:00')
    params.append('pickup_date', pickupDate)
    params.append('pickup_location', PICKUP_LOCATION)
    params.append('expected_package_count', String(eligible.length))

    const res = await fetch(DELHIVERY_PICKUP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      next: { revalidate: 0 },
    })

    const data = await res.json()

    if (data.error || (typeof data.prepaid === 'string' && data.prepaid.toLowerCase().includes('wallet'))) {
      return NextResponse.json({
        error: 'Delhivery rejected the pickup request',
        details: data.prepaid || data.error || JSON.stringify(data),
      }, { status: 422 })
    }

    const pickupId = data.id || data.pickup_id || data.pk || null

    for (const ord of eligible) {
      await query(
        `UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status NOT IN ('processing','shipped','delivered')`,
        [ord.id]
      )
    }

    return NextResponse.json({
      pickupId,
      pickupDate,
      orderCount: eligible.length,
      awbs: eligible.map((o: any) => o.awb_number),
      raw: data,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
