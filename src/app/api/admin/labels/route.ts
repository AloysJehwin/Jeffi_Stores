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
      return NextResponse.json({ error: 'Maximum 200 items per download' }, { status: 400 })
    }
    if (!LABEL_SIZES.find(s => s.size === size)) {
      return NextResponse.json({ error: 'Invalid size' }, { status: 400 })
    }
    const copiesNum = Math.min(Math.max(parseInt(copies) || 1, 1), 100)

    const productIds: string[] = []
    const variantIds: string[] = []
    for (const id of product_ids as string[]) {
      if (id.startsWith('variant:')) variantIds.push(id.slice(8))
      else if (id.startsWith('product:')) productIds.push(id.slice(8))
      else productIds.push(id)
    }

    const results: LabelProduct[] = []

    if (productIds.length > 0) {
      const rows = await queryMany<LabelProduct>(
        `SELECT p.id, p.id AS product_id, NULL AS variant_id,
                p.name, NULL AS variant_name,
                p.sku, p.slug, p.mrp, p.sale_price, p.base_price,
                COALESCE(p.gst_percentage, 0) AS gst_percentage,
                p.gtin, b.name AS brand_name
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.id = ANY($1::uuid[])`,
        [productIds]
      )
      for (const r of (rows || [])) {
        results.push({ ...r, id: `product:${r.id}` })
      }
    }

    if (variantIds.length > 0) {
      const rows = await queryMany<LabelProduct>(
        `SELECT 'variant:' || pv.id AS id,
                p.id AS product_id, pv.id AS variant_id,
                p.name, pv.variant_name,
                pv.sku, p.slug,
                COALESCE(pv.mrp, 0) AS mrp,
                pv.sale_price,
                COALESCE(pv.price, p.base_price) AS base_price,
                COALESCE(p.gst_percentage, 0) AS gst_percentage,
                COALESCE(pv.gtin, p.gtin) AS gtin,
                b.name AS brand_name
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE pv.id = ANY($1::uuid[])`,
        [variantIds]
      )
      for (const r of (rows || [])) results.push(r)
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'No products found' }, { status: 404 })
    }

    const ordered = product_ids
      .map(id => results.find(r => r.id === id))
      .filter(Boolean) as LabelProduct[]

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
