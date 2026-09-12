import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const TOKEN = await resolveDelhiveryToken()
    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<{ awb_number: string | null }>(
      'SELECT awb_number FROM orders WHERE id = $1',
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const body = await request.json()
    const { dcn, ewbn } = body

    if (!dcn || !ewbn) {
      return NextResponse.json({ error: 'dcn (invoice number) and ewbn (e-waybill number) are required' }, { status: 400 })
    }

    const url = `https://track.delhivery.com/api/rest/ewaybill/${encodeURIComponent(order.awb_number)}/`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Token ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: [{ dcn, ewbn }] }),
      next: { revalidate: 0 },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Delhivery ewaybill update failed', details: JSON.stringify(data) },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true, raw: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
