import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const orderId = request.nextUrl.searchParams.get('order_id')
    if (!orderId) return NextResponse.json({ error: 'order_id required' }, { status: 400 })

    // Get order items where the product is perishable
    const items = await queryMany<any>(`
      SELECT
        oi.id AS order_item_id,
        oi.product_id,
        oi.variant_id,
        oi.sub_variant_id,
        oi.product_name,
        oi.variant_name,
        oi.quantity,
        oi.buy_unit,
        oi.batch_id
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1 AND p.perishable = true
    `, [orderId])

    if (!items.length) return NextResponse.json({ items: [] })

    const result = []

    for (const item of items) {
      // Resolve base qty (apply unit factor for count-dimension units)
      const unitRow = await queryOne<{ factor: string; dimension: string }>(`
        SELECT COALESCE(puv.factor, pup.factor) AS factor,
               COALESCE(puv.dimension, pup.dimension) AS dimension
        FROM (SELECT 1) x
        LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
        LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL
      `, [item.buy_unit, item.product_id, item.variant_id || null])

      const rawQty = parseFloat(item.quantity)
      const requiredQty = (unitRow?.dimension === 'count' && unitRow?.factor)
        ? rawQty * parseFloat(unitRow.factor)
        : rawQty

      // Available batches for this product/variant, FIFO by expiry then created_at
      const batches = await queryMany<any>(`
        SELECT
          pb.id,
          pb.lot_number,
          pb.manufacture_date,
          pb.expiry_date,
          pb.quantity_remaining,
          sl.display_code AS location
        FROM product_batches pb
        LEFT JOIN shelf_locations sl ON sl.id = pb.location_id
        WHERE pb.product_id = $1
          AND (pb.variant_id = $2 OR ($2::uuid IS NULL AND pb.variant_id IS NULL))
          AND (pb.sub_variant_id = $3 OR ($3::uuid IS NULL AND pb.sub_variant_id IS NULL))
          AND pb.quantity_remaining > 0
        ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
      `, [item.product_id, item.variant_id || null, item.sub_variant_id || null])

      result.push({
        order_item_id: item.order_item_id,
        product_name: item.product_name,
        variant_name: item.variant_name || null,
        required_qty: requiredQty,
        already_assigned: !!item.batch_id,
        batches,
      })
    }

    return NextResponse.json({ items: result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
