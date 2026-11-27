import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getGstr3b, parseSources, type Gstr3bReport } from '@/lib/gst/returns'

export const dynamic = 'force-dynamic'

// GSTR-3B for the period; ?sources= as on GSTR-1. ?format=csv is the legacy flat download.
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

    const gstr3b = await getGstr3b(from, to, parseSources(searchParams.get('sources')))

    if (format === 'csv') {
      return new NextResponse(buildGSTR3BCSV(gstr3b), {
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

function buildGSTR3BCSV(data: Gstr3bReport): string {
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
