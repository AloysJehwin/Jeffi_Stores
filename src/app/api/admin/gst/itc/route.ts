import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { round2 } from '@/lib/gst'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!hasScope(admin.role, admin.scopes, 'gst:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const format = searchParams.get('format') || 'json'

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to date params required' }, { status: 400 })
    }

    const rows = await queryMany(
      `
      SELECT
        po.id AS po_id,
        po.po_number,
        po.order_date,
        s.name AS supplier_name,
        s.gstin AS supplier_gstin,
        poi.product_name,
        COALESCE(poi.sku, '') AS sku,
        poi.quantity,
        poi.unit_cost,
        COALESCE(poi.tax_rate, 0)::numeric AS tax_rate,
        ROUND(poi.quantity * poi.unit_cost, 2) AS taxable_amount,
        ROUND(poi.quantity * poi.unit_cost * COALESCE(poi.tax_rate, 0) / 100, 2) AS tax_amount,
        po.status AS po_status
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_date >= $1
        AND po.order_date < ($2::date + interval '1 day')
        AND po.status IN ('received', 'partial')
      ORDER BY po.order_date ASC, po.po_number ASC
    `,
      [from, to]
    )

    const totalTaxable = rows.reduce((s: number, r: any) => s + parseFloat(r.taxable_amount || '0'), 0)
    const totalTax = rows.reduce((s: number, r: any) => s + parseFloat(r.tax_amount || '0'), 0)

    const bySupplier: Record<string, any> = {}
    for (const r of rows) {
      const key = r.supplier_name
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplierName: r.supplier_name,
          gstin: r.supplier_gstin,
          taxable: 0,
          tax: 0,
          poCount: new Set(),
        }
      }
      bySupplier[key].taxable += parseFloat(r.taxable_amount || '0')
      bySupplier[key].tax += parseFloat(r.tax_amount || '0')
      bySupplier[key].poCount.add(r.po_id)
    }

    const supplierSummary = Object.values(bySupplier).map((s: any) => ({
      supplierName: s.supplierName,
      gstin: s.gstin,
      poCount: s.poCount.size,
      taxable: round2(s.taxable),
      tax: round2(s.tax),
    }))

    if (format === 'csv') {
      const lines = [
        'PO Number,Date,Supplier,Supplier GSTIN,Product,SKU,Qty,Unit Cost,GST Rate %,Taxable Amount,Tax Amount',
      ]
      for (const r of rows) {
        lines.push(
          [
            r.po_number,
            r.order_date ? new Date(r.order_date).toLocaleDateString('en-IN') : '',
            `"${r.supplier_name}"`,
            r.supplier_gstin || '',
            `"${r.product_name}"`,
            r.sku,
            r.quantity,
            r.unit_cost,
            r.tax_rate,
            r.taxable_amount,
            r.tax_amount,
          ].join(',')
        )
      }
      return new NextResponse(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="ITC_${from}_to_${to}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { from, to },
      summary: {
        lineCount: rows.length,
        totalTaxable: round2(totalTaxable),
        totalTax: round2(totalTax),
      },
      supplierSummary,
      rows,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
