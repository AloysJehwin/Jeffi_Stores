import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { generateQuotationPDF, QuotationBusiness } from '@/lib/quotation-pdf'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const qt = await queryOne<any>(`SELECT * FROM quotations WHERE id = $1`, [params.id])
    if (!qt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [params.id])

    const settingsRows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
      []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    const business: QuotationBusiness = {
      gstin: s.business_gstin || '',
      legalName: s.business_legal_name || '',
      tradeName: s.business_trade_name || '',
      address: s.business_address || '',
      state: s.business_state || '',
      stateCode: s.business_state_code || '',
      phone: s.business_phone || '',
      email: s.business_email || '',
      bankName: s.bank_name || '',
      bankAccount: s.bank_account || '',
      bankIfsc: s.bank_ifsc || '',
      bankBranch: s.bank_branch || '',
    }

    const pdfItems = (items || []).map((item: any) => ({
      description: item.description,
      hsn_code: item.hsn_code,
      gst_rate: Number(item.gst_rate),
      quantity: Number(item.quantity),
      unit: item.unit,
      rate: Number(item.rate),
      discount_pct: Number(item.discount_pct),
      amount: Number(item.amount),
    }))

    const buffer = await generateQuotationPDF(qt, pdfItems, business)
    const filename = `quotation-${qt.quote_number.replace(/\//g, '-')}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
