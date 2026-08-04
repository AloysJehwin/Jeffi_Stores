import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const [primarySupplier, purchaseHistory] = await Promise.all([
      queryOne<any>(
        `SELECT s.id, s.name, s.gstin, s.contact_name, s.phone, s.email
         FROM products p
         JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = $1`,
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
           pv.variant_name
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id
         JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN product_variants pv ON pv.id = poi.variant_id
         WHERE poi.product_id = $1
         ORDER BY po.order_date DESC
         LIMIT 20`,
        [id]
      ),
    ])

    const lastPurchase = purchaseHistory[0] ?? null

    return NextResponse.json({
      primarySupplier: primarySupplier ?? null,
      purchaseHistory,
      lastPurchasePrice: lastPurchase ? Number(lastPurchase.unit_cost) : null,
      lastPurchaseDate: lastPurchase ? lastPurchase.order_date : null,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
