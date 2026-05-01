import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'
import { generateLabelPDF, generateLabelSheetPDF, LABEL_SIZES, LabelProduct, LabelSize } from '@/lib/label-pdf'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { product_ids, size, copies, sheet } = await request.json()

    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json({ error: 'product_ids required' }, { status: 400 })
    }
    if (product_ids.length > 200) {
      return NextResponse.json({ error: 'Maximum 200 products per download' }, { status: 400 })
    }
    if (!LABEL_SIZES.find(s => s.size === size)) {
      return NextResponse.json({ error: 'Invalid size' }, { status: 400 })
    }
    const copiesNum = Math.min(Math.max(parseInt(copies) || 1, 1), 100)

    const rows = await queryMany<LabelProduct>(
      `SELECT p.id, p.name, p.sku, p.slug, p.mrp, p.sale_price, p.base_price, p.gtin,
              b.name AS brand_name
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = ANY($1::uuid[])`,
      [product_ids]
    )

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'No products found' }, { status: 404 })
    }

    const ordered = product_ids.map(id => rows.find(r => r.id === id)).filter(Boolean) as LabelProduct[]

    const pdfBuffer = sheet
      ? await generateLabelSheetPDF(ordered, size as LabelSize, copiesNum)
      : await generateLabelPDF(ordered, size as LabelSize, copiesNum)

    const spec = LABEL_SIZES.find(s => s.size === size)!
    const filename = `labels-${spec.size}-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to generate labels' }, { status: 500 })
  }
}
