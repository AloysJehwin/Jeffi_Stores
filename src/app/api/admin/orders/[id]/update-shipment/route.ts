import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const Schema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  add: z.string().nullish(),
  products_desc: z.string().nullish(),
  gm: z.number().nullish(),
  shipment_height: z.number().nullish(),
  shipment_width: z.number().nullish(),
  shipment_length: z.number().nullish(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'At least one field required' }
)

const TOKEN = process.env.DELHIVERY_API_KEY
const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null }>(
      'SELECT awb_number FROM orders WHERE id = $1',
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const raw = await request.json().catch(() => null)
    if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = parseBody(Schema, raw)
    if (!parsed.ok) return parsed.response
    const { name, phone, add, products_desc, gm, shipment_height, shipment_width, shipment_length } = parsed.data

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
