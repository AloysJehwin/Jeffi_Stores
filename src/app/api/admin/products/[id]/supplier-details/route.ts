import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const [primarySupplier, suppliers, purchaseHistory] = await Promise.all([
      queryOne<any>(
        `SELECT s.id, s.name, s.gstin, s.contact_name, s.phone, s.email
         FROM products p
         JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = $1`,
        [id]
      ),
      // Current supplier price list per LEAF (product / variant / sub-variant),
      // latest dated row per (leaf, supplier). Carries leaf ids + names for grouping.
      queryMany<any>(
        `SELECT DISTINCT ON (ps.variant_id, ps.sub_variant_id, ps.supplier_id)
           ps.id, ps.supplier_id, s.name AS supplier_name, s.gstin,
           ps.variant_id, ps.sub_variant_id,
           pv.variant_name, psv.sub_variant_name,
           ps.unit_cost, ps.currency, ps.gst_inclusive, ps.moq,
           ps.lead_time_days, ps.is_preferred, ps.effective_date, ps.notes
         FROM product_suppliers ps
         JOIN suppliers s ON s.id = ps.supplier_id
         LEFT JOIN product_variants pv ON pv.id = ps.variant_id
         LEFT JOIN product_sub_variants psv ON psv.id = ps.sub_variant_id
         WHERE ps.product_id = $1 AND ps.is_active = true
         ORDER BY ps.variant_id, ps.sub_variant_id, ps.supplier_id, ps.effective_date DESC, ps.created_at DESC`,
        [id]
      ),
      queryMany<any>(
        `SELECT
           po.id AS po_id,
           po.po_number,
           po.order_date,
           po.status,
           s.id AS supplier_id,
           s.name AS supplier_name,
           poi.unit_cost,
           poi.quantity,
           poi.line_total_incl_gst,
           poi.sku,
           pv.variant_name,
           psv.sub_variant_name
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id
         JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN product_variants pv ON pv.id = poi.variant_id
         LEFT JOIN product_sub_variants psv ON psv.id = poi.sub_variant_id
         WHERE poi.product_id = $1
         ORDER BY po.order_date DESC
         LIMIT 20`,
        [id]
      ),
    ])

    // Sort current suppliers by price ascending, then compute the cheapest per leaf.
    suppliers.sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost))
    const NIL = '00000000-0000-0000-0000-000000000000'
    const bestByLeaf: Record<string, string> = {}
    for (const r of suppliers) {
      const k = `${r.variant_id || NIL}:${r.sub_variant_id || NIL}`
      if (!(k in bestByLeaf)) bestByLeaf[k] = r.supplier_id
    }

    // Compute last purchase + lowest-ever price PER LEAF so the UI can show
    // stats scoped to the specific variant/sub-variant rather than the whole product.
    const lastPurchaseByLeaf: Record<string, { price: number; date: string; supplierName: string }> = {}
    const lowestHistByLeaf: Record<string, number> = {}
    for (const h of purchaseHistory) {
      const k = `${h.variant_id || NIL}:${h.sub_variant_id || NIL}`
      const cost = Number(h.unit_cost)
      if (!(k in lastPurchaseByLeaf)) {
        // purchaseHistory is ORDER BY order_date DESC so first seen = most recent
        lastPurchaseByLeaf[k] = { price: cost, date: h.order_date, supplierName: h.supplier_name }
      }
      if (!(k in lowestHistByLeaf) || cost < lowestHistByLeaf[k]) {
        lowestHistByLeaf[k] = cost
      }
    }

    const lastPurchase = purchaseHistory[0] ?? null
    const lowestHistPrice = purchaseHistory.length
      ? Math.min(...purchaseHistory.map((h: any) => Number(h.unit_cost)))
      : null

    return NextResponse.json({
      primarySupplier: primarySupplier ?? null,
      suppliers,
      bestByLeaf,
      purchaseHistory,
      lastPurchaseByLeaf,
      lowestHistByLeaf,
      lastPurchasePrice: lastPurchase ? Number(lastPurchase.unit_cost) : null,
      lastPurchaseDate: lastPurchase ? lastPurchase.order_date : null,
      lowestHistoricalPrice: lowestHistPrice,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
