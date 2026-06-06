import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    status: zNonEmpty.optional(),
    awb_number: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field is required',
  })

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(`
      SELECT o.*,
        row_to_json(a) AS shipping_address
      FROM orders o
      LEFT JOIN addresses a ON a.id = o.shipping_address_id
      WHERE o.id = $1
    `, [params.id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const items = await queryMany<any>(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.product_sku, oi.variant_id, oi.variant_name,
             oi.sub_variant_id, oi.hsn_code, oi.gst_rate, oi.quantity, oi.unit_price, oi.total_price,
             oi.taxable_amount, oi.cgst_amount, oi.sgst_amount, oi.igst_amount, oi.tax_amount,
             CASE WHEN psv.id IS NOT NULL THEN json_build_object(
               'id', psv.id,
               'sub_variant_name', psv.sub_variant_name,
               'sku', psv.sku,
               'inventory_quantity', psv.inventory_quantity
             ) ELSE NULL END AS sub_variant,
             CASE WHEN pv.id IS NOT NULL THEN json_build_object(
               'id', pv.id,
               'variant_name', pv.variant_name,
               'sku', pv.sku,
               'inventory_quantity', pv.inventory_quantity
             ) ELSE NULL END AS variant
      FROM order_items oi
      LEFT JOIN product_sub_variants psv ON psv.id = oi.sub_variant_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
    `, [params.id])

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json()
    const parsed = parseBody(patchSchema, raw)
    if (!parsed.ok) return parsed.response

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
