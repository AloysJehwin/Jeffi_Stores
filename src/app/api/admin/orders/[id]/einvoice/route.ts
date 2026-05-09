import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'
import { generateIRN, cancelIRN, isEInvoiceConfigured, EInvoicePayload, EInvoiceItem } from '@/lib/einvoice'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne(`
      SELECT o.*,
        a.full_name, a.address_line1, a.city, a.state, a.postal_code,
        i.invoice_number
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN invoices i ON i.order_id = o.id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.invoice_number) return NextResponse.json({ error: 'Invoice not generated yet' }, { status: 422 })
    if (order.irn && order.irn_status === 'generated') {
      return NextResponse.json({ error: 'IRN already generated', irn: order.irn }, { status: 409 })
    }

    const items = await queryMany(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
      [params.id]
    )

    const settingsRows = await queryMany(
      "SELECT key, value FROM site_settings WHERE key LIKE 'business_%'", []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    const invoiceDate = new Date(order.invoice_date || order.created_at)
    const dd = String(invoiceDate.getDate()).padStart(2, '0')
    const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0')
    const yyyy = invoiceDate.getFullYear()

    const einvoiceItems: EInvoiceItem[] = items.map((item: any, idx: number) => {
      const taxable = parseFloat(item.taxable_amount || '0')
      const cgst = parseFloat(item.cgst_amount || '0')
      const sgst = parseFloat(item.sgst_amount || '0')
      const igst = parseFloat(item.igst_amount || '0')
      const total = taxable + cgst + sgst + igst
      return {
        slNo: String(idx + 1),
        productDesc: item.product_name,
        isService: 'N' as const,
        hsnCode: item.hsn_code || '9999',
        qty: item.quantity,
        unit: 'NOS',
        unitPrice: parseFloat(item.unit_price),
        totalAmount: parseFloat(item.total_price),
        assAmt: taxable,
        gstRate: parseFloat(item.gst_rate || '18'),
        igstAmt: igst,
        cgstAmt: cgst,
        sgstAmt: sgst,
        totalItemVal: total,
      }
    })

    const payload: EInvoicePayload = {
      invoiceNumber: order.invoice_number,
      invoiceDate: `${dd}/${mm}/${yyyy}`,
      supplyType: order.buyer_gstin ? 'B2B' : 'B2C',
      sellerGstin: s.business_gstin || '',
      sellerLegalName: s.business_legal_name || '',
      sellerAddress1: s.business_address || '',
      sellerCity: s.business_city || '',
      sellerStateCode: s.business_state_code || '33',
      sellerPincode: parseInt(s.business_pincode || '600001'),
      buyerGstin: order.buyer_gstin || '',
      buyerLegalName: order.full_name || order.customer_name,
      buyerAddress1: order.address_line1 || '',
      buyerCity: order.city || '',
      buyerStateCode: order.state_code || '33',
      buyerPincode: parseInt(order.postal_code || '600001'),
      buyerPos: order.state_code || s.business_state_code || '33',
      items: einvoiceItems,
      assVal: parseFloat(order.taxable_amount || '0'),
      cgstVal: parseFloat(order.cgst_amount || '0'),
      sgstVal: parseFloat(order.sgst_amount || '0'),
      igstVal: parseFloat(order.igst_amount || '0'),
      totalInvVal: parseFloat(order.total_amount),
    }

    const result = await generateIRN(payload)

    await queryOne(
      `UPDATE orders SET
        irn = $1, irn_ack_no = $2, irn_ack_dt = $3,
        signed_qr = $4, irn_status = $5
       WHERE id = $6`,
      [result.irn, result.ackNo, new Date(), result.signedQRCode, result.status, params.id]
    )

    return NextResponse.json({
      success: true,
      irn: result.irn,
      ackNo: result.ackNo,
      ackDt: result.ackDt,
      status: result.status,
      configured: isEInvoiceConfigured(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne('SELECT irn, irn_status FROM orders WHERE id = $1', [params.id])
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.irn) return NextResponse.json({ error: 'No IRN on this order' }, { status: 422 })
    if (order.irn_status === 'cancelled') return NextResponse.json({ error: 'IRN already cancelled' }, { status: 409 })

    const body = await request.json().catch(() => ({}))
    const reason: 1 | 2 | 3 | 4 = body.reason || 3
    const remark: string = body.remark || 'Order cancelled'

    if (!order.irn.startsWith('STUB-')) {
      await cancelIRN(order.irn, reason, remark)
    }

    await queryOne(
      `UPDATE orders SET irn_status = 'cancelled', irn_cancelled_at = NOW() WHERE id = $1`,
      [params.id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
