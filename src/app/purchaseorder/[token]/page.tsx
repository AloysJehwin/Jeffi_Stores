import { notFound } from 'next/navigation'
import { queryMany, queryOne } from '@/lib/db'
import PurchaseOrderViewClient from './PurchaseOrderViewClient'

export const dynamic = 'force-dynamic'

export default async function PurchaseOrderViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const po = await queryOne<any>(
    `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email,
            s.address AS supplier_address, s.gstin AS supplier_gstin
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.view_token = $1`,
    [token]
  )
  if (!po) notFound()

  const items = await queryMany<any>(
    `SELECT poi.quantity, poi.unit_cost, poi.total_cost, poi.tax_rate,
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

  const grns = await queryMany<any>(
    `SELECT g.id, g.grn_number, g.received_date, g.notes,
            json_agg(json_build_object(
              'po_item_id', gi.po_item_id,
              'quantity_received', gi.quantity_received,
              'unit_cost', gi.unit_cost,
              'purchase_unit_factor', gi.purchase_unit_factor,
              'tax_rate', poi.tax_rate,
              'gst_inclusive', poi.gst_inclusive
            ) ORDER BY gi.id) AS grn_items
     FROM grns g
     JOIN grn_items gi ON gi.grn_id = g.id
     JOIN purchase_order_items poi ON poi.id = gi.po_item_id
     WHERE g.po_id = $1
     GROUP BY g.id
     ORDER BY g.received_date DESC, g.created_at DESC`,
    [po.id]
  )

  return <PurchaseOrderViewClient po={po} items={items || []} settings={s} token={token} grns={grns || []} />
}
