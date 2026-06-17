import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const product = await queryOne(
      `SELECT p.*,
        json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
        json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
        COALESCE(
          (SELECT json_agg(pi ORDER BY pi.display_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS product_images,
        COALESCE(
          (SELECT json_agg(
             json_build_object(
               'id', pv.id, 'sku', pv.sku, 'variant_name', pv.variant_name,
               'price', pv.price, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
               'mrp_ex_gst', pv.mrp_ex_gst, 'wholeprice_ex_gst', pv.wholeprice_ex_gst,
               'stock_quantity', pv.stock_quantity, 'pricing_type', pv.pricing_type,
               'unit', pv.unit, 'numeric_value', pv.numeric_value,
               'attributes', pv.attributes, 'is_active', pv.is_active,
               'variant_images', COALESCE(
                 (SELECT json_agg(vi ORDER BY vi.display_order ASC)
                  FROM variant_images vi WHERE vi.variant_id = pv.id),
                 '[]'::json
               ),
               'sub_variants', COALESCE(
                 (SELECT json_agg(sv ORDER BY sv.created_at ASC)
                  FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
                 '[]'::json
               )
             ) ORDER BY pv.variant_name
           )
           FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          '[]'::json
        ) AS product_variants,
        ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
        ${VARIANT_MIN_PRICE_SQL} AS variant_min_price,
        COALESCE(
          (SELECT json_agg(
             json_build_object(
               'id', pu.id,
               'variant_id', pu.variant_id,
               'unit', pu.unit,
               'factor', pu.factor,
               'is_base', pu.is_base,
               'is_sell_default', pu.is_sell_default,
               'is_purchase_default', pu.is_purchase_default,
               'display_label', pu.display_label,
               'dimension', pu.dimension,
               'min_qty', pu.min_qty,
               'max_qty', pu.max_qty,
               'qty_step', pu.qty_step
             ) ORDER BY pu.is_sell_default DESC, pu.is_base DESC
           )
           FROM product_units pu WHERE pu.product_id = p.id
          ),
          '[]'::json
        ) AS product_units,
        COALESCE(
          (SELECT json_agg(
             json_build_object(
               'id', pur.id,
               'product_unit_id', pur.product_unit_id,
               'rule_type', pur.rule_type,
               'config', pur.config,
               'priority', pur.priority
             ) ORDER BY pur.priority
           )
           FROM product_unit_rules pur
           JOIN product_units pu2 ON pur.product_unit_id = pu2.id
           WHERE pu2.product_id = p.id AND pur.is_active = TRUE
          ),
          '[]'::json
        ) AS product_unit_rules
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.slug = $1 AND p.is_active = true`,
      [params.slug]
    )

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({ product })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
