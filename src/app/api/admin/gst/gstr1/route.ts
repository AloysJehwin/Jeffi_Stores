import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const format = searchParams.get('format') || 'json'

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to date params required (YYYY-MM-DD)' }, { status: 400 })
    }

    const rows = await queryMany(`
      SELECT
        o.invoice_number,
        o.invoice_date,
        o.order_number,
        o.customer_name,
        o.buyer_gstin,
        o.is_igst,
        o.taxable_amount,
        o.cgst_amount,
        o.sgst_amount,
        o.igst_amount,
        o.total_amount,
        o.state AS buyer_state,
        o.irn,
        o.irn_ack_no,
        o.irn_ack_dt,
        json_agg(json_build_object(
          'product_name', oi.product_name,
          'hsn_code', COALESCE(oi.hsn_code, '9999'),
          'gst_rate', COALESCE(oi.gst_rate, 18),
          'quantity', oi.quantity,
          'taxable_amount', oi.taxable_amount,
          'cgst_amount', oi.cgst_amount,
          'sgst_amount', oi.sgst_amount,
          'igst_amount', oi.igst_amount,
          'total_price', oi.total_price
        ) ORDER BY oi.created_at) AS items
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.invoice_date >= $1
        AND o.invoice_date < ($2::date + interval '1 day')
        AND o.invoice_number IS NOT NULL
        AND o.payment_status = 'paid'
      GROUP BY o.id
      ORDER BY o.invoice_date ASC
    `, [from, to])

    const b2b = rows.filter((r: any) => r.buyer_gstin)
    const b2c = rows.filter((r: any) => !r.buyer_gstin)

    const hsnSummary = buildHsnSummary(rows)

    if (format === 'csv') {
      const csv = buildGSTR1CSV(rows)
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="GSTR1_${from}_to_${to}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { from, to },
      summary: {
        totalInvoices: rows.length,
        b2bCount: b2b.length,
        b2cCount: b2c.length,
        totalTaxable: sum(rows, 'taxable_amount'),
        totalCgst: sum(rows, 'cgst_amount'),
        totalSgst: sum(rows, 'sgst_amount'),
        totalIgst: sum(rows, 'igst_amount'),
        totalTax: sum(rows, 'cgst_amount') + sum(rows, 'sgst_amount') + sum(rows, 'igst_amount'),
        totalInvoiceValue: sum(rows, 'total_amount'),
      },
      b2b,
      b2c,
      hsnSummary,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

function sum(rows: any[], field: string): number {
  return Math.round(rows.reduce((acc: number, r: any) => acc + parseFloat(r[field] || '0'), 0) * 100) / 100
}

function buildHsnSummary(rows: any[]) {
  const map: Record<string, { hsnCode: string; gstRate: number; taxableVal: number; igst: number; cgst: number; sgst: number }> = {}
  for (const row of rows) {
    for (const item of (row.items || [])) {
      const key = `${item.hsn_code}-${item.gst_rate}`
      if (!map[key]) {
        map[key] = { hsnCode: item.hsn_code || '9999', gstRate: parseFloat(item.gst_rate || '18'), taxableVal: 0, igst: 0, cgst: 0, sgst: 0 }
      }
      map[key].taxableVal += parseFloat(item.taxable_amount || '0')
      map[key].igst += parseFloat(item.igst_amount || '0')
      map[key].cgst += parseFloat(item.cgst_amount || '0')
      map[key].sgst += parseFloat(item.sgst_amount || '0')
    }
  }
  return Object.values(map).map(h => ({
    hsnCode: h.hsnCode,
    gstRate: h.gstRate,
    taxableVal: Math.round(h.taxableVal * 100) / 100,
    igstAmt: Math.round(h.igst * 100) / 100,
    cgstAmt: Math.round(h.cgst * 100) / 100,
    sgstAmt: Math.round(h.sgst * 100) / 100,
    totalTax: Math.round((h.igst + h.cgst + h.sgst) * 100) / 100,
  }))
}

function buildGSTR1CSV(rows: any[]): string {
  const headers = [
    'Invoice No', 'Invoice Date', 'Customer Name', 'Buyer GSTIN',
    'Invoice Type', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Invoice Value',
    'IRN', 'IRN Ack No'
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r.invoice_number,
      r.invoice_date ? new Date(r.invoice_date).toLocaleDateString('en-IN') : '',
      `"${r.customer_name}"`,
      r.buyer_gstin || '',
      r.buyer_gstin ? 'B2B' : 'B2C',
      r.taxable_amount,
      r.cgst_amount,
      r.sgst_amount,
      r.igst_amount,
      (parseFloat(r.cgst_amount || 0) + parseFloat(r.sgst_amount || 0) + parseFloat(r.igst_amount || 0)).toFixed(2),
      r.total_amount,
      r.irn || '',
      r.irn_ack_no || '',
    ].join(','))
  }
  return lines.join('\n')
}
