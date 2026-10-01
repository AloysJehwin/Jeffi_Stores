import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const po = await queryOne<any>(
      `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email,
              s.address AS supplier_address, s.gstin AS supplier_gstin
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.view_token = $1`,
      [token]
    )
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const items = await queryMany<any>(
      `SELECT poi.id, poi.quantity, poi.unit_cost, poi.total_cost, poi.tax_rate,
              poi.gst_inclusive, poi.line_total_incl_gst, poi.purchase_unit,
              poi.purchase_unit_factor, poi.sku, poi.quantity_received,
              COALESCE(poi.product_name, p.name) AS product_name,
              pv.variant_name,
              pu_base.unit AS base_unit,
              pu_sell.unit  AS sell_unit,
              pu_sell.factor AS sell_unit_factor,
              pu_sell.display_label AS sell_unit_label
       FROM purchase_order_items poi
       LEFT JOIN products p ON p.id = poi.product_id
       LEFT JOIN product_variants pv ON pv.id = poi.variant_id
       LEFT JOIN product_units pu_base
              ON pu_base.is_base = true
             AND (poi.variant_id IS NOT NULL AND pu_base.variant_id = poi.variant_id
               OR poi.variant_id IS NULL AND pu_base.product_id = poi.product_id AND pu_base.variant_id IS NULL)
       LEFT JOIN product_units pu_sell
              ON (poi.variant_id IS NOT NULL AND pu_sell.variant_id = poi.variant_id
               OR poi.variant_id IS NULL AND pu_sell.product_id = poi.product_id AND pu_sell.variant_id IS NULL)
             AND pu_sell.is_purchase_default = true
       WHERE poi.po_id = $1`,
      [po.id]
    )
    const settingsRows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
      []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    return NextResponse.json({ po, items: items || [], settings: s })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
