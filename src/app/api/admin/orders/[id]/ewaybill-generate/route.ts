import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'
import { generateEWayBill, isEWayBillConfigured, EWayBillPayload } from '@/lib/ewaybill'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne(`
      SELECT o.*,
        a.full_name, a.address_line1, a.city, a.state, a.postal_code, a.state_code,
        i.invoice_number
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN invoices i ON i.order_id = o.id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.invoice_number) return NextResponse.json({ error: 'Invoice not generated yet' }, { status: 422 })
    if (order.eway_bill_no) {
      return NextResponse.json({ error: 'E-way bill already generated', ewbNo: order.eway_bill_no }, { status: 409 })
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

    const body = await request.json().catch(() => ({}))

    const invoiceDate = new Date(order.invoice_date || order.created_at)
    const dd = String(invoiceDate.getDate()).padStart(2, '0')
    const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0')
    const yyyy = invoiceDate.getFullYear()

    const payload: EWayBillPayload = {
      supplyType: 'O',
      subSupplyType: '1',
      docType: 'INV',
      docNo: order.invoice_number,
      docDate: `${dd}/${mm}/${yyyy}`,
      fromGstin: s.business_gstin || '',
      fromTrdName: s.business_trade_name || s.business_legal_name || '',
      fromAddr1: s.business_address || '',
      fromPlace: s.business_city || '',
      fromPincode: parseInt(s.business_pincode || '600001'),
      fromStateCode: parseInt(s.business_state_code || '33'),
      toGstin: order.buyer_gstin || 'URP',
      toTrdName: order.full_name || order.customer_name,
      toAddr1: order.address_line1 || '',
      toPlace: order.city || '',
      toPincode: parseInt(order.postal_code || '600001'),
      toStateCode: parseInt(order.state_code || '33'),
      totalValue: parseFloat(order.total_amount),
      cgstValue: parseFloat(order.cgst_amount || '0'),
      sgstValue: parseFloat(order.sgst_amount || '0'),
      igstValue: parseFloat(order.igst_amount || '0'),
      cessValue: 0,
      transporterName: body.transporterName || '',
      transporterId: body.transporterId || '',
      transMode: body.transMode || '1',
      transDistance: body.transDistance || 1,
      vehicleNo: body.vehicleNo || order.awb_number || '',
      vehicleType: 'R',
      items: items.map((item: any) => ({
        productName: item.product_name,
        productDesc: item.product_name,
        hsnCode: item.hsn_code || '9999',
        quantity: item.quantity,
        qtyUnit: 'NOS',
        taxableAmount: parseFloat(item.taxable_amount || item.total_price),
        sgstRate: order.is_igst ? 0 : parseFloat(item.gst_rate || '18') / 2,
        cgstRate: order.is_igst ? 0 : parseFloat(item.gst_rate || '18') / 2,
        igstRate: order.is_igst ? parseFloat(item.gst_rate || '18') : 0,
        cessRate: 0,
      })),
    }

    const result = await generateEWayBill(payload)

    await queryOne(
      `UPDATE orders SET eway_bill_no = $1, eway_bill_date = NOW(), eway_bill_valid_upto = $2 WHERE id = $3`,
      [result.ewbNo, result.ewbValidTill ? new Date(result.ewbValidTill) : null, params.id]
    )

    return NextResponse.json({
      success: true,
      ewbNo: result.ewbNo,
      ewbDt: result.ewbDt,
      ewbValidTill: result.ewbValidTill,
      status: result.status,
      configured: isEWayBillConfigured(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
