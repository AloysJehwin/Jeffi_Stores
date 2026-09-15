import { NextRequest, NextResponse } from 'next/server'
import { productLabel } from '@/lib/product-label'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { generateReceiptPDF, ReceiptBusinessSettings, ReceiptOrder, ReceiptItem } from '@/lib/receipt-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id } = await params

    const sale = await queryOne<any>(
      `SELECT * FROM cash_sales WHERE id = $1`,
      [id]
    )
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    const [saleItems, settingsRows] = await Promise.all([
      queryMany(`SELECT * FROM cash_sale_items WHERE sale_id = $1 ORDER BY created_at`, [id]),
      queryMany(`SELECT key, value FROM site_settings WHERE key LIKE 'business_%'`, []),
    ])

    const settings: Record<string, string> = {}
    for (const row of (settingsRows || [])) {
      settings[row.key] = row.value || ''
    }

    const business: ReceiptBusinessSettings = {
      gstin: settings.business_gstin || '',
      legalName: settings.business_legal_name || '',
      tradeName: settings.business_trade_name || '',
      address: settings.business_address || '',
      phone: settings.business_phone || '',
    }

    const receiptOrder: ReceiptOrder = {
      invoice_number: sale.invoice_number || sale.sale_number,
      invoice_date: sale.invoice_date,
      payment_mode: sale.payment_mode || 'cash',
      customer_name: sale.customer_name || 'Walk-in Customer',
      notes: sale.notes || '',
      taxable_amount: parseFloat(sale.taxable_amount || '0'),
      cgst_amount: parseFloat(sale.cgst_amount || '0'),
      sgst_amount: parseFloat(sale.sgst_amount || '0'),
      igst_amount: parseFloat(sale.igst_amount || '0'),
      is_igst: sale.is_igst || false,
      total_amount: parseFloat(sale.total_amount),
    }

    const receiptItems: ReceiptItem[] = (saleItems || []).map((it: any) => ({
      product_name: productLabel(it, ' — '),
      quantity: parseFloat(it.quantity),
      unit_price: parseFloat(it.unit_price),
      discount_amount: parseFloat(it.discount_amount || '0') || undefined,
      total_price: parseFloat(it.total_price),
      taxable_amount: parseFloat(it.taxable_amount || '0'),
      cgst_amount: parseFloat(it.cgst_amount || '0'),
      sgst_amount: parseFloat(it.sgst_amount || '0'),
      igst_amount: parseFloat(it.igst_amount || '0'),
      gst_rate: parseFloat(it.gst_rate || '18'),
      buy_unit: it.buy_unit || null,
    }))

    const pdfBuffer = await generateReceiptPDF(receiptOrder, receiptItems, business)
    const filename = `receipt-${sale.invoice_number || sale.sale_number}.pdf`

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
