import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getGstr1, parseSources, type GstInvoice } from '@/lib/gst/returns'

export const dynamic = 'force-dynamic'

// GSTR-1 for the period; ?sources=online|cash_sale keeps only those revenue sources (all when absent).
// ?format=csv is the legacy flat download; the admin page exports through /api/admin/export/gst.gstr1.
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
      return NextResponse.json({ error: 'from and to date params required (YYYY-MM-DD)' }, { status: 400 })
    }

    const report = await getGstr1(from, to, parseSources(searchParams.get('sources')))

    if (format === 'csv') {
      const csv = buildGSTR1CSV([...report.b2b, ...report.b2c].sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date))))
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="GSTR1_${from}_to_${to}.csv"`,
        },
      })
    }

    return NextResponse.json(report)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

function buildGSTR1CSV(rows: GstInvoice[]): string {
  const headers = [
    'Invoice No',
    'Invoice Date',
    'Customer Name',
    'Buyer GSTIN',
    'Invoice Type',
    'Taxable Value',
    'CGST',
    'SGST',
    'IGST',
    'Total Tax',
    'Invoice Value',
    'IRN',
    'IRN Ack No',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.invoice_number,
        r.invoice_date ? new Date(r.invoice_date).toLocaleDateString('en-IN') : '',
        `"${r.customer_name}"`,
        r.buyer_gstin || '',
        r.buyer_gstin ? 'B2B' : 'B2C',
        r.taxable_amount,
        r.cgst_amount,
        r.sgst_amount,
        r.igst_amount,
        (parseFloat(String(r.cgst_amount || 0)) + parseFloat(String(r.sgst_amount || 0)) + parseFloat(String(r.igst_amount || 0))).toFixed(2),
        r.total_amount,
        r.irn || '',
        r.irn_ack_no || '',
      ].join(',')
    )
  }
  return lines.join('\n')
}
