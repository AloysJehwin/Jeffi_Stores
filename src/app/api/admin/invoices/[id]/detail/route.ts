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
    if (!hasScope(admin.role, admin.scopes, 'invoices:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT
        o.id, o.order_number, o.invoice_number, o.invoice_date, o.created_at, o.updated_at,
        o.customer_name, o.customer_phone, o.customer_email,
        o.buyer_gstin, o.is_igst,
        o.subtotal, o.tax_amount, o.taxable_amount,
        o.cgst_amount, o.sgst_amount, o.igst_amount,
        o.total_amount, o.discount_amount, o.business_discount_amount, o.shipping_amount,
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
              oi.quantity, oi.unit_price, oi.total_price, oi.discount_amount,
              oi.taxable_amount, oi.cgst_amount, oi.sgst_amount, oi.igst_amount, oi.tax_amount,
              oi.buy_unit, oi.buy_mode,
              COALESCE(puv.factor, pup.factor, pu_sv.factor, pu_sp.factor) AS sell_unit_factor,
              COALESCE(puv.dimension, pup.dimension, pu_sv.dimension, pu_sp.dimension) AS sell_unit_dimension
       FROM order_items oi
       LEFT JOIN product_units puv ON puv.unit = oi.buy_unit AND puv.product_id = oi.product_id AND puv.variant_id = oi.variant_id AND oi.buy_unit IS NOT NULL
       LEFT JOIN product_units pup ON pup.unit = oi.buy_unit AND pup.product_id = oi.product_id AND pup.variant_id IS NULL AND oi.buy_unit IS NOT NULL
         AND (oi.variant_id IS NULL OR puv.id IS NULL)
       LEFT JOIN product_variants pvar ON pvar.id = oi.variant_id
       LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL
       LEFT JOIN products prod ON prod.id = oi.product_id AND oi.variant_id IS NULL
       LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL
       WHERE oi.order_id = $1 ORDER BY oi.created_at`,
      [id]
    )

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
