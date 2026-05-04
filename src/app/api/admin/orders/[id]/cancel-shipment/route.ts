import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY
const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null; order_number: string }>(
      'SELECT awb_number, order_number FROM orders WHERE id = $1',
      [params.id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const res = await fetch(DELHIVERY_EDIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ waybill: order.awb_number, cancellation: 'true' }),
      next: { revalidate: 0 },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Delhivery cancellation failed', details: JSON.stringify(data) },
        { status: 502 }
      )
    }

    await query(
      `UPDATE orders SET awb_number = NULL, updated_at = NOW() WHERE id = $1`,
      [params.id]
    )

    return NextResponse.json({ success: true, waybill: order.awb_number, raw: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
