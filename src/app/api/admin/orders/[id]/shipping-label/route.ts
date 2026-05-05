import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
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

    const pdfSize = (request.nextUrl.searchParams.get('size') === '4R') ? '4R' : 'A4'
    const labelUrl = `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(order.awb_number)}&pdf=true&pdf_size=${pdfSize}`

    const res = await fetch(labelUrl, {
      headers: { Authorization: `Token ${TOKEN}` },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Delhivery label API returned ${res.status}` }, { status: 502 })
    }

    const buffer = await res.arrayBuffer()

    const safeOrderNum = (order.order_number || params.id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')
    const inline = request.nextUrl.searchParams.get('inline') === '1'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline
          ? `inline; filename="shipping-label-${safeOrderNum}.pdf"`
          : `attachment; filename="shipping-label-${safeOrderNum}.pdf"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
