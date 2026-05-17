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

    const contentType = res.headers.get('content-type') || ''
    let buffer: ArrayBuffer

    if (contentType.includes('application/json')) {
      const json = await res.json()
      const pdfUrl = json?.packages?.[0]?.pdf_download_link
      if (!pdfUrl) return NextResponse.json({ error: 'No PDF link in Delhivery response' }, { status: 502 })
      const pdfRes = await fetch(pdfUrl)
      if (!pdfRes.ok) return NextResponse.json({ error: `Failed to fetch PDF from S3: ${pdfRes.status}` }, { status: 502 })
      buffer = await pdfRes.arrayBuffer()
    } else {
      buffer = await res.arrayBuffer()
    }

    const safeOrderNum = (order.order_number || params.id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')
    const print = request.nextUrl.searchParams.get('print') === '1'
    const inline = request.nextUrl.searchParams.get('inline') === '1'

    if (print) {
      const pdfBase64 = Buffer.from(buffer).toString('base64')
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Shipping Label — ${safeOrderNum}</title>
<style>
  html, body, embed { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 4in; height: 6in; background: #fff; }
  @page { size: 4in 6in; margin: 0; }
  embed { display: block; width: 4in; height: 6in; border: none; }
</style>
</head>
<body>
<embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="384" height="576" />
<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 800);
  });
</script>
</body>
</html>`
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

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
