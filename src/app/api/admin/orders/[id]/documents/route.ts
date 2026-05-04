import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY

const ALLOWED_DOC_TYPES = ['SIGNATURE_URL', 'RVP_QC_IMAGE', 'EPOD', 'SELLER_RETURN_IMAGE'] as const
type DocType = typeof ALLOWED_DOC_TYPES[number]

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const docType = request.nextUrl.searchParams.get('doc_type') as DocType | null
    if (!docType || !ALLOWED_DOC_TYPES.includes(docType)) {
      return NextResponse.json(
        { error: `doc_type must be one of: ${ALLOWED_DOC_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const order = await queryOne<{ awb_number: string | null; order_number: string }>(
      'SELECT awb_number, order_number FROM orders WHERE id = $1',
      [params.id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const url = `https://track.delhivery.com/api/rest/fetch/pkg/document/?doc_type=${encodeURIComponent(docType)}&waybill=${encodeURIComponent(order.awb_number)}`

    const res = await fetch(url, {
      headers: { Authorization: `Token ${TOKEN}` },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Delhivery API returned ${res.status}`, details: text },
        { status: 502 }
      )
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const buffer = await res.arrayBuffer()

    const safeOrderNum = (order.order_number || params.id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')
    const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('image') ? 'jpg' : 'bin'
    const filename = `${docType.toLowerCase()}-${safeOrderNum}.${ext}`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
