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
    const productId = request.nextUrl.searchParams.get('product_id')
    const variantId = request.nextUrl.searchParams.get('variant_id') || null
    const subVariantId = request.nextUrl.searchParams.get('sub_variant_id') || null
    const lineItemId = request.nextUrl.searchParams.get('line_item_id') || 'item'
    const qty = parseFloat(request.nextUrl.searchParams.get('qty') || '1')

    // Direct product lookup (invoice create — no order yet)
    if (productId) {
      const productRow = await queryOne<{ name: string; perishable: boolean; serialized: boolean }>(`SELECT name, perishable, serialized FROM products WHERE id = $1`, [productId])
      if (!productRow?.perishable && !productRow?.serialized) return NextResponse.json({ items: [], serialized_items: [] })

      const variantRow = variantId ? await queryOne<{ variant_name: string }>(`SELECT variant_name FROM product_variants WHERE id = $1`, [variantId]) : null

      if (productRow?.serialized) {
        return NextResponse.json({
          items: [],
          serialized_items: [{
            order_item_id: lineItemId,
            product_name: productRow.name || '',
            variant_name: variantRow?.variant_name || null,
            required_qty: qty,
            already_assigned: false,
            product_id: productId,
            variant_id: variantId,
            sub_variant_id: subVariantId,
          }],
        })
      }

      const batches = await queryMany<any>(`
        SELECT pb.id, pb.lot_number, pb.manufacture_date, pb.expiry_date, pb.quantity_remaining,
               sl.display_code AS location
        FROM product_batches pb
        LEFT JOIN shelf_locations sl ON sl.id = pb.location_id
        WHERE pb.product_id = $1
          AND (pb.variant_id = $2 OR ($2::uuid IS NULL AND pb.variant_id IS NULL))
          AND (pb.sub_variant_id = $3 OR ($3::uuid IS NULL AND pb.sub_variant_id IS NULL))
          AND pb.quantity_remaining > 0
        ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
      `, [productId, variantId, subVariantId])

      return NextResponse.json({ items: [{
        order_item_id: lineItemId,
        product_name: productRow?.name || '',
        variant_name: variantRow?.variant_name || null,
        required_qty: qty,
        already_assigned: false,
        batches,
      }], serialized_items: [] })
    }

    const quotationId = request.nextUrl.searchParams.get('quotation_id')

    if (!orderId && !quotationId) return NextResponse.json({ error: 'order_id, quotation_id, or product_id required' }, { status: 400 })

    // Quotation items path — used before order is created (quotation → invoice conversion)
    if (quotationId) {
      const qItems = await queryMany<any>(`
        SELECT
          qi.id AS order_item_id,
          qi.product_id,
          qi.variant_id,
          qi.sub_variant_id,
          qi.description AS product_name,
          NULL AS variant_name,
          qi.quantity,
          qi.buy_unit,
          qi.sold_unit_factor,
          COALESCE(qi.base_quantity, qi.quantity) AS base_quantity,
          NULL AS batch_id,
          p.perishable,
          p.serialized
        FROM quotation_items qi
        JOIN products p ON p.id = qi.product_id
        WHERE qi.quotation_id = $1 AND qi.product_id IS NOT NULL AND (p.perishable = true OR p.serialized = true)
      `, [quotationId])

      if (!qItems.length) return NextResponse.json({ items: [], serialized_items: [] })

      const qResult = []
      const qSerializedResult = []

      for (const item of qItems) {
        const rawQty = parseFloat(item.quantity)
        const requiredQty = item.base_quantity ? parseFloat(item.base_quantity) : rawQty

        if (item.serialized) {
          qSerializedResult.push({
            order_item_id: item.order_item_id,
            product_name: item.product_name,
            variant_name: item.variant_name || null,
            required_qty: requiredQty,
            already_assigned: false,
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            sub_variant_id: item.sub_variant_id || null,
          })
        } else {
          const batches = await queryMany<any>(`
            SELECT pb.id, pb.lot_number, pb.manufacture_date, pb.expiry_date, pb.quantity_remaining,
                   sl.display_code AS location
            FROM product_batches pb
            LEFT JOIN shelf_locations sl ON sl.id = pb.location_id
            WHERE pb.product_id = $1
              AND (pb.variant_id = $2 OR ($2::uuid IS NULL AND pb.variant_id IS NULL))
              AND (pb.sub_variant_id = $3 OR ($3::uuid IS NULL AND pb.sub_variant_id IS NULL))
              AND pb.quantity_remaining > 0
            ORDER BY pb.expiry_date ASC NULLS LAST, pb.created_at ASC
          `, [item.product_id, item.variant_id || null, item.sub_variant_id || null])

          qResult.push({
            order_item_id: item.order_item_id,
            product_name: item.product_name,
            variant_name: item.variant_name || null,
            required_qty: requiredQty,
            already_assigned: false,
            batches,
          })
        }
      }

      return NextResponse.json({ items: qResult, serialized_items: qSerializedResult })
    }

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
        oi.batch_id,
        p.perishable,
        p.serialized
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1 AND (p.perishable = true OR p.serialized = true)
    `, [orderId])

    if (!items.length) return NextResponse.json({ items: [], serialized_items: [] })

    const result = []
    const serializedResult = []

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

      if (item.serialized) {
        serializedResult.push({
          order_item_id: item.order_item_id,
          product_name: item.product_name,
          variant_name: item.variant_name || null,
          required_qty: requiredQty,
          already_assigned: !!item.batch_id,
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          sub_variant_id: item.sub_variant_id || null,
        })
      } else {
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
    }

    return NextResponse.json({ items: result, serialized_items: serializedResult })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
