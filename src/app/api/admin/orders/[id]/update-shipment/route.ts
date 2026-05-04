import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY
const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null }>(
      'SELECT awb_number FROM orders WHERE id = $1',
      [params.id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const body = await request.json()
    const { name, phone, add, products_desc, gm, shipment_height, shipment_width, shipment_length } = body

    const payload: Record<string, unknown> = { waybill: order.awb_number }
    if (name) payload.name = name
    if (phone) payload.phone = phone
    if (add) payload.add = add
    if (products_desc) payload.products_desc = products_desc
    if (gm != null) payload.gm = gm
    if (shipment_height != null) payload.shipment_height = shipment_height
    if (shipment_width != null) payload.shipment_width = shipment_width
    if (shipment_length != null) payload.shipment_length = shipment_length

    const res = await fetch(DELHIVERY_EDIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      next: { revalidate: 0 },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Delhivery update failed', details: JSON.stringify(data) },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, raw: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
