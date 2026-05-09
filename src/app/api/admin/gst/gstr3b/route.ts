import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'

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

    const outward = await queryOne(`
      SELECT
        SUM(o.taxable_amount)::numeric AS total_taxable,
        SUM(o.cgst_amount)::numeric    AS total_cgst,
        SUM(o.sgst_amount)::numeric    AS total_sgst,
        SUM(o.igst_amount)::numeric    AS total_igst,
        COUNT(*)::int                  AS invoice_count
      FROM orders o
      WHERE o.invoice_date >= $1
        AND o.invoice_date < ($2::date + interval '1 day')
        AND o.invoice_number IS NOT NULL
        AND o.payment_status = 'paid'
    `, [from, to])

    const byRate = await queryMany(`
      SELECT
        oi.gst_rate,
        o.is_igst,
        SUM(oi.taxable_amount)::numeric AS taxable,
        SUM(oi.cgst_amount)::numeric    AS cgst,
        SUM(oi.sgst_amount)::numeric    AS sgst,
        SUM(oi.igst_amount)::numeric    AS igst
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.invoice_date >= $1
        AND o.invoice_date < ($2::date + interval '1 day')
        AND o.invoice_number IS NOT NULL
        AND o.payment_status = 'paid'
      GROUP BY oi.gst_rate, o.is_igst
      ORDER BY oi.gst_rate
    `, [from, to])

    const totalCgst = parseFloat(outward?.total_cgst || '0')
    const totalSgst = parseFloat(outward?.total_sgst || '0')
    const totalIgst = parseFloat(outward?.total_igst || '0')
    const totalTax = totalCgst + totalSgst + totalIgst

    const settingsRows = await queryMany(
      "SELECT key, value FROM site_settings WHERE key LIKE 'business_%'", []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    const gstr3b = {
      period: { from, to },
      gstin: s.business_gstin || '',
      legalName: s.business_legal_name || '',
      table31: {
        label: '3.1 Details of Outward Supplies',
        outwardTaxable: {
          taxableValue: parseFloat(outward?.total_taxable || '0'),
          integratedTax: totalIgst,
          centralTax: totalCgst,
          stateTax: totalSgst,
          cess: 0,
        },
      },
      table32: {
        label: '3.2 Inter-state supplies to unregistered persons',
        supplies: byRate
          .filter((r: any) => r.is_igst && !r.buyer_gstin)
          .map((r: any) => ({
            gstRate: parseFloat(r.gst_rate || '0'),
            taxableValue: parseFloat(r.taxable || '0'),
            igst: parseFloat(r.igst || '0'),
          })),
      },
      table4: {
        label: '4. Eligible ITC (manual entry required — purchase data not available)',
        note: 'Purchase cycle module required for auto-population',
        itcAvailable: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      },
      table5: {
        label: '5. Values exempt/nil-rated/non-GST',
        exempt: 0,
        nilRated: 0,
        nonGst: 0,
      },
      table6: {
        label: '6. Payment of Tax',
        igst: { tax: totalIgst, interestLate: 0, other: 0, tds: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, cashPaid: totalIgst },
        cgst: { tax: totalCgst, interestLate: 0, other: 0, tds: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, cashPaid: totalCgst },
        sgst: { tax: totalSgst, interestLate: 0, other: 0, tds: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, cashPaid: totalSgst },
        cess: { tax: 0, interestLate: 0, other: 0, tds: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0, cashPaid: 0 },
      },
      summary: {
        totalInvoices: outward?.invoice_count || 0,
        totalTaxable: parseFloat(outward?.total_taxable || '0'),
        totalCgst,
        totalSgst,
        totalIgst,
        totalTax,
        byGstRate: byRate.map((r: any) => ({
          gstRate: parseFloat(r.gst_rate || '0'),
          isIgst: r.is_igst,
          taxable: parseFloat(r.taxable || '0'),
          cgst: parseFloat(r.cgst || '0'),
          sgst: parseFloat(r.sgst || '0'),
          igst: parseFloat(r.igst || '0'),
        })),
      },
    }

    if (format === 'csv') {
      const csv = buildGSTR3BCSV(gstr3b)
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="GSTR3B_${from}_to_${to}.csv"`,
        },
      })
    }

    return NextResponse.json(gstr3b)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

function buildGSTR3BCSV(data: any): string {
  const lines: string[] = []
  lines.push(`GSTR-3B Summary,${data.period.from} to ${data.period.to}`)
  lines.push(`GSTIN,${data.gstin}`)
  lines.push(`Legal Name,${data.legalName}`)
  lines.push('')
  lines.push('3.1 Outward Supplies')
  lines.push('Taxable Value,Integrated Tax,Central Tax,State/UT Tax,Cess')
  const t = data.table31.outwardTaxable
  lines.push(`${t.taxableValue},${t.integratedTax},${t.centralTax},${t.stateTax},${t.cess}`)
  lines.push('')
  lines.push('Tax Breakup by GST Rate')
  lines.push('GST Rate,Supply Type,Taxable,CGST,SGST,IGST')
  for (const r of data.summary.byGstRate) {
    lines.push(`${r.gstRate}%,${r.isIgst ? 'Inter-State' : 'Intra-State'},${r.taxable},${r.cgst},${r.sgst},${r.igst}`)
  }
  lines.push('')
  lines.push('6. Tax Payable')
  lines.push('Tax Head,Tax,Cash to Pay')
  lines.push(`IGST,${data.table6.igst.tax},${data.table6.igst.cashPaid}`)
  lines.push(`CGST,${data.table6.cgst.tax},${data.table6.cgst.cashPaid}`)
  lines.push(`SGST,${data.table6.sgst.tax},${data.table6.sgst.cashPaid}`)
  return lines.join('\n')
}
