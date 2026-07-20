import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { buildLabelPDF, type LabelItem } from '@/lib/shipping-label-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN = process.env.DELHIVERY_API_KEY

async function build4RPDF(pkg: any, awb: string, orderRow: any, items: LabelItem[]): Promise<Buffer> {
  return buildLabelPDF(pkg, awb, orderRow, items)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    if (!TOKEN) return NextResponse.json({ error: 'Delhivery API key not configured' }, { status: 503 })

    const order = await queryOne<any>(
      `SELECT o.order_number, o.awb_number, o.total_amount,
              sa.full_name, sa.address_line1, sa.address_line2, sa.landmark,
              sa.city, sa.state, sa.postal_code
       FROM orders o
       LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
       WHERE o.id = $1`,
      [id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ error: 'No AWB number for this order' }, { status: 404 })

    const itemRows = await queryMany<any>(
      `SELECT product_name, variant_name, quantity, unit_price, total_price
       FROM order_items WHERE order_id = $1 ORDER BY id`,
      [id]
    )
    const items: LabelItem[] = (itemRows || []).map((r) => ({
      name: [r.product_name, r.variant_name].filter(Boolean).join(' — '),
      qty: Number(r.quantity) || 1,
      price: Number(r.unit_price) || 0,
      total: Number(r.total_price) || 0,
    }))

    const pdfSize = (request.nextUrl.searchParams.get('size') === '4R') ? '4R' : 'A4'
    const print = request.nextUrl.searchParams.get('print') === '1'
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    const safeOrderNum = (order.order_number || id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '-')

    if (pdfSize === '4R') {
      const labelUrl = `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(order.awb_number)}`
      const res = await fetch(labelUrl, { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } })
      if (!res.ok) return NextResponse.json({ error: `Delhivery label API returned ${res.status}` }, { status: 502 })

      const data = await res.json()
      const pkg = data?.packages?.[0] ?? {}

      const buffer = await build4RPDF(pkg, order.awb_number, order, items)

      if (print) {
        const pdfBase64 = buffer.toString('base64')
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}@page{size:4in 6in;margin:0;}iframe{display:block;width:100%;height:100%;border:none;}</style></head><body><iframe id="f" src="data:application/pdf;base64,${pdfBase64}" onload="try{var f=document.getElementById('f');f.contentWindow.focus();f.contentWindow.print();}catch(e){}"></iframe></body></html>`
        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }

      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': inline
            ? `inline; filename="shipping-label-${safeOrderNum}.pdf"`
            : `attachment; filename="shipping-label-${safeOrderNum}.pdf"`,
          'Content-Length': String(buffer.byteLength),
        },
      })
    }

    const labelUrl = `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(order.awb_number)}&pdf=true`
    const res = await fetch(labelUrl, { headers: { Authorization: `Token ${TOKEN}` }, next: { revalidate: 0 } })
    if (!res.ok) return NextResponse.json({ error: `Delhivery label API returned ${res.status}` }, { status: 502 })

    const contentType = res.headers.get('content-type') || ''
    let buffer: ArrayBuffer

    if (contentType.includes('application/pdf')) {
      buffer = await res.arrayBuffer()
    } else {
      const json = await res.json()
      const pdfUrl: string | undefined = json?.packages?.[0]?.pdf_download_link
      if (!pdfUrl) return NextResponse.json({ error: 'No PDF link in Delhivery response' }, { status: 502 })
      const pdfRes = await fetch(pdfUrl)
      if (!pdfRes.ok) return NextResponse.json({ error: `Failed to fetch PDF from S3: ${pdfRes.status}` }, { status: 502 })
      buffer = await pdfRes.arrayBuffer()
    }

    if (print) {
      const pdfBase64 = Buffer.from(buffer).toString('base64')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}@page{size:A4;margin:0;}iframe{display:block;width:100%;height:100%;border:none;}</style></head><body><iframe id="f" src="data:application/pdf;base64,${pdfBase64}" onload="try{var f=document.getElementById('f');f.contentWindow.focus();f.contentWindow.print();}catch(e){}"></iframe></body></html>`
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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
