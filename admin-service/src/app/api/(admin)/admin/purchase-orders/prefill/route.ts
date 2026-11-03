import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { duplicateLine, parsePrefillLines, reorderLine } from '@/lib/purchasing/prefill'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Leaf details shared by both modes: names, tax, HSN, MRP and the base (sell) unit.
const LEAF = `
  SELECT p.id AS product_id, pv.id AS variant_id, sv.id AS sub_variant_id,
         p.name, pv.variant_name, sv.sub_variant_name,
         COALESCE(sv.sku, pv.sku, p.sku) AS sku,
         COALESCE(p.gst_percentage, 0) AS gst, p.hsn_code,
         COALESCE(sv.mrp, pv.mrp, p.mrp, 0) AS mrp,
         COALESCE(vsu.display_label, vsu.unit, psu.display_label, psu.unit) AS sell_unit_label,
         COALESCE(vsu.dimension, psu.dimension) AS sell_unit_dimension
  FROM products p
  LEFT JOIN product_variants pv ON pv.id = $2::uuid AND pv.product_id = p.id
  LEFT JOIN product_sub_variants sv ON sv.id = $3::uuid AND sv.variant_id = pv.id
  LEFT JOIN product_units vsu ON vsu.id = pv.sell_unit_id
  LEFT JOIN product_units psu ON psu.id = p.sell_unit_id
  WHERE p.id = $1::uuid`

/** Seed lines for a new PO: ?duplicate=<poId>, or ?supplier=<id>&lines=pid:vid:svid:qty,... */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    const dup = sp.get('duplicate')
    if (dup) {
      if (!UUID.test(dup)) return NextResponse.json({ error: 'Invalid PO id' }, { status: 400 })
      const po = await queryOne<{ supplier_id: string; notes: string | null; po_number: string }>(
        `SELECT supplier_id, notes, po_number FROM purchase_orders WHERE id = $1`,
        [dup]
      )
      if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
      const items = await queryMany<Record<string, unknown>>(
        `SELECT poi.*, p.hsn_code, COALESCE(sv.mrp, pv.mrp, p.mrp, 0) AS mrp,
                COALESCE(vsu.display_label, vsu.unit, psu.display_label, psu.unit) AS sell_unit_label,
                COALESCE(vsu.dimension, psu.dimension) AS sell_unit_dimension
         FROM purchase_order_items poi
         LEFT JOIN products p ON p.id = poi.product_id
         LEFT JOIN product_variants pv ON pv.id = poi.variant_id
         LEFT JOIN product_sub_variants sv ON sv.id = poi.sub_variant_id
         LEFT JOIN product_units vsu ON vsu.id = pv.sell_unit_id
         LEFT JOIN product_units psu ON psu.id = p.sell_unit_id
         WHERE poi.po_id = $1 AND poi.product_id IS NOT NULL
         ORDER BY poi.id`,
        [dup]
      )
      return NextResponse.json({
        supplier_id: po.supplier_id,
        notes: po.notes ? `${po.notes}\n(copied from ${po.po_number})` : `Copied from ${po.po_number}`,
        lines: items.map(duplicateLine),
      })
    }

    const supplierId = sp.get('supplier')
    if (supplierId && !UUID.test(supplierId)) return NextResponse.json({ error: 'Invalid supplier' }, { status: 400 })
    const wanted = parsePrefillLines(sp.get('lines'))
    if (!wanted.length) return NextResponse.json({ error: 'Nothing to prefill' }, { status: 400 })

    const lines = []
    for (const w of wanted) {
      const leaf = await queryOne<Record<string, unknown>>(LEAF, [w.product_id, w.variant_id, w.sub_variant_id])
      if (!leaf) continue
      const ps = supplierId
        ? await queryOne<Record<string, unknown>>(
            `SELECT unit_cost, gst_inclusive, purchase_unit, purchase_unit_factor FROM product_suppliers
             WHERE product_id = $1 AND supplier_id = $4 AND is_active = TRUE
               AND variant_id IS NOT DISTINCT FROM (CASE WHEN $3::uuid IS NULL THEN $2::uuid END)
               AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
             ORDER BY is_preferred DESC, effective_date DESC LIMIT 1`,
            [w.product_id, w.variant_id, w.sub_variant_id, supplierId]
          )
        : null
      lines.push(reorderLine(leaf, ps, w.quantity))
    }
    return NextResponse.json({ supplier_id: supplierId || null, notes: null, lines })
  } catch (err) {
    console.error('[purchase-orders prefill]', err)
    return NextResponse.json({ error: 'Failed to prefill' }, { status: 500 })
  }
}
