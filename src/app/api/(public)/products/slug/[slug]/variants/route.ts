import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const { gstEnabled } = await getFeatureFlags()
    const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

    const product = await queryOne(
      `
      SELECT
        COALESCE(
          (SELECT json_agg(
             jsonb_build_object(
               'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
               'price', pv.price, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
               'stock_status', pv.stock_status,
               'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
               'sub_variant_type', pv.sub_variant_type, 'sell_unit_id', pv.sell_unit_id,
               'variant_type', pv.variant_type,
               'variant_images', COALESCE(
                 (SELECT json_agg(vi ORDER BY vi.display_order)
                  FROM variant_images vi WHERE vi.variant_id = pv.id),
                 '[]'::json
               ),
               'sub_variants', COALESCE(
                 (SELECT json_agg(sv ORDER BY sv.sub_variant_name)
                  FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
                 '[]'::json
               )
             ) ORDER BY pv.variant_name
           )
           FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          '[]'::json
        ) AS product_variants,
        ${MIN_PRICE_SQL} AS variant_min_price,
        ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp,
        ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
        COALESCE(
          (SELECT json_agg(
             json_build_object(
               'id', pu.id, 'variant_id', pu.variant_id, 'sub_variant_id', pu.sub_variant_id, 'unit', pu.unit,
               'factor', pu.factor, 'is_base', pu.is_base,
               'is_purchase_default', pu.is_purchase_default, 'display_label', pu.display_label,
               'dimension', pu.dimension, 'min_qty', pu.min_qty, 'max_qty', pu.max_qty, 'qty_step', pu.qty_step
             ) ORDER BY pu.is_base DESC
           )
           FROM product_units pu WHERE pu.product_id = p.id
          ),
          '[]'::json
        ) AS product_units
      FROM products p
      WHERE p.slug = $1 AND p.is_active = true
    `,
      [slug]
    )

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({
      product_variants: product.product_variants ?? [],
      product_units: product.product_units ?? [],
      variant_min_price: product.variant_min_price ?? null,
      variant_min_mrp: product.variant_min_mrp ?? null,
      variant_stock_total: product.variant_stock_total ?? 0,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
