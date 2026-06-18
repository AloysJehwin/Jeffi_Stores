import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT
        o.id, o.order_number, o.invoice_number, o.invoice_date, o.created_at, o.updated_at,
        o.customer_name, o.customer_phone, o.customer_email,
        o.buyer_gstin, o.is_igst,
        o.subtotal, o.tax_amount, o.taxable_amount,
        o.cgst_amount, o.sgst_amount, o.igst_amount,
        o.total_amount, o.discount_amount, o.shipping_amount,
        o.payment_status, o.payment_mode, o.status, o.source, o.notes,
        o.tracking_number, o.shipping_method, o.shipped_at,
        o.irn, o.irn_status, o.eway_bill_no,
        o.razorpay_qr_id, o.razorpay_qr_image_url, o.needs_delivery,
        a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone,
        inv.pdf_url
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN invoices inv ON inv.order_id = o.id
      WHERE o.id = $1`,
      [id]
    )

    if (!order) {
      const cashSale = await queryOne<{ id: string }>(`SELECT id FROM cash_sales WHERE id = $1`, [id])
      if (cashSale) return NextResponse.json({ redirect: `/admin/cash-sale/${cashSale.id}` }, { status: 200 })
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const items = await queryMany<any>(
      `SELECT oi.product_name, oi.product_sku, oi.variant_name, oi.hsn_code, oi.gst_rate,
              oi.quantity, oi.unit_price, oi.total_price,
              oi.taxable_amount, oi.cgst_amount, oi.sgst_amount, oi.igst_amount, oi.tax_amount,
              oi.buy_unit, oi.buy_mode,
              pu.factor AS sell_unit_factor,
              pu.dimension AS sell_unit_dimension
       FROM order_items oi
       LEFT JOIN product_units pu ON pu.unit = oi.buy_unit AND pu.product_id = oi.product_id
       WHERE oi.order_id = $1 ORDER BY oi.created_at`,
      [id]
    )

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
