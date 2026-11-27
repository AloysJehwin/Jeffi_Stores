import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { itcSummary, loadItcRows } from '@/lib/gst/returns'

export const dynamic = 'force-dynamic'

// Input tax credit from received purchase orders in the period. ?format=csv is the legacy download.
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

    const rows = await loadItcRows(from, to)

    if (format === 'csv') {
      const lines = ['PO Number,Date,Supplier,Supplier GSTIN,Product,SKU,Qty,Unit Cost,GST Rate %,Taxable Amount,Tax Amount']
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

    return NextResponse.json({ period: { from, to }, ...itcSummary(rows), rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
