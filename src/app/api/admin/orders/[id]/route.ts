import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<any>(`
      SELECT o.*,
        row_to_json(a) AS shipping_address
      FROM orders o
      LEFT JOIN addresses a ON a.id = o.shipping_address_id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const items = await queryMany<any>(`
      SELECT id, product_id, product_name, product_sku, variant_id, variant_name,
             hsn_code, gst_rate, quantity, unit_price, total_price,
             taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
      FROM order_items WHERE order_id = $1
    `, [params.id])

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
