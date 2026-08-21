import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Lightweight product resolver for the scan-action popup. Any authenticated admin may
// look up a scanned product's display fields to choose an action; the action buttons
// themselves are scope-gated client-side and each target page enforces its own scope.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const pid = (sp.get('pid') || '').trim()
  const vid = (sp.get('vid') || '').trim()
  const sku = (sp.get('sku') || '').trim()

  try {
    let row: any = null
    if (vid) {
      row = await queryOne(
        `SELECT p.id AS product_id, pv.id AS variant_id, p.name, pv.variant_name,
                pv.sku, COALESCE(pv.price, p.base_price) AS base_price, COALESCE(pv.mrp, p.mrp) AS mrp,
                COALESCE(p.gst_percentage, 0) AS gst_percentage, b.name AS brand_name,
                COALESCE(pv.inventory_quantity, 0) AS inventory_quantity
         FROM product_variants pv JOIN products p ON p.id = pv.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE pv.id = $1::uuid`,
        [vid]
      )
    }
    if (!row && pid) {
      row = await queryOne(
        `SELECT p.id AS product_id, NULL::uuid AS variant_id, p.name, NULL AS variant_name,
                p.sku, p.base_price, p.mrp, COALESCE(p.gst_percentage, 0) AS gst_percentage,
                b.name AS brand_name, COALESCE(p.inventory_quantity, 0) AS inventory_quantity
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.id = $1::uuid`,
        [pid]
      )
    }
    if (!row && sku) {
      row = await queryOne(
        `SELECT p.id AS product_id, NULL::uuid AS variant_id, p.name, NULL AS variant_name,
                p.sku, p.base_price, p.mrp, COALESCE(p.gst_percentage, 0) AS gst_percentage,
                b.name AS brand_name, COALESCE(p.inventory_quantity, 0) AS inventory_quantity
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.sku = $1 LIMIT 1`,
        [sku]
      )
    }
    if (!row) return NextResponse.json({ product: null }, { status: 404 })
    return NextResponse.json({ product: row })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
