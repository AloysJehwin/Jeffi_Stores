import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
        o.payment_status, o.status, o.source, o.notes,
        o.tracking_number, o.shipping_method, o.shipped_at,
        o.irn, o.irn_status, o.eway_bill_no,
        a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone,
        inv.pdf_url
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN invoices inv ON inv.order_id = o.id
      WHERE o.id = $1 AND o.invoice_number IS NOT NULL`,
      [params.id]
    )

    if (!order) {
      const cashSale = await queryOne<{ id: string }>(`SELECT id FROM cash_sales WHERE id = $1`, [params.id])
      if (cashSale) return NextResponse.json({ redirect: `/admin/cash-sale/${cashSale.id}` }, { status: 200 })
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const items = await queryMany<any>(
      `SELECT product_name, product_sku, variant_name, hsn_code, gst_rate,
              quantity, unit_price, total_price,
              taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
       FROM order_items WHERE order_id = $1 ORDER BY created_at`,
      [params.id]
    )

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
