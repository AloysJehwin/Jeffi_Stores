import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Shared SELECT for the product/variant "item" shape. Mirrors the columns the
// line-item suggest query packs (see /api/admin/suggest suggestLineItems) so a
// scanned line has the SAME pricing/tax/discount/hsn data as a Name selection.
const PRODUCT_SELECT = `
  p.id, p.id AS product_id, NULL::uuid AS variant_id,
  p.name, NULL AS variant_name,
  p.sku, p.slug,
  COALESCE(p.mrp, 0)::numeric AS mrp,
  p.price_ex_gst, p.base_price,
  COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
  p.hsn_code,
  COALESCE(p.discount_pct, 0)::numeric AS discount_pct,
  b.name AS brand_name, c.name AS category_name,
  p.gtin, p.barcode, p.serialized, p.perishable,
  p.stock_status, p.inventory_quantity, p.is_active, p.has_variants,
  (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url`

const VARIANT_SELECT = `
  pv.id, p.id AS product_id, pv.id AS variant_id,
  p.name, pv.variant_name,
  pv.sku, p.slug,
  COALESCE(pv.mrp, p.mrp, 0)::numeric AS mrp,
  pv.price_ex_gst, COALESCE(pv.price, p.base_price) AS base_price,
  COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
  p.hsn_code,
  COALESCE(pv.discount_pct, p.discount_pct, 0)::numeric AS discount_pct,
  b.name AS brand_name, c.name AS category_name,
  COALESCE(pv.gtin, p.gtin) AS gtin, p.barcode, p.serialized, p.perishable,
  pv.stock_status, pv.inventory_quantity, pv.is_active, false AS has_variants,
  (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url`

async function findProductBy(where: string, val: string) {
  return queryOne<any>(
    `SELECT ${PRODUCT_SELECT}
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where} LIMIT 1`,
    [val]
  )
}

async function findVariantBy(where: string, val: string) {
  return queryOne<any>(
    `SELECT ${VARIANT_SELECT}
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where} LIMIT 1`,
    [val]
  )
}

// POST /api/admin/scan/resolve  { code: string }
// Resolves a scanned string to a product, variant, or a single serialized unit.
// Match priority: product SKU → variant SKU → product barcode → product/variant GTIN → serial number.
export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

    // 1. Exact SKU (case-insensitive) — most common intent
    let item = await findProductBy('LOWER(p.sku) = LOWER($1)', code)
    if (item) return NextResponse.json({ kind: 'product', code, item })

    let variant = await findVariantBy('LOWER(pv.sku) = LOWER($1)', code)
    if (variant) return NextResponse.json({ kind: 'variant', code, item: variant })

    // 2. Product barcode
    item = await findProductBy('p.barcode = $1', code)
    if (item) return NextResponse.json({ kind: 'product', code, item })

    // 3. GTIN (variant first — more specific, then product)
    variant = await findVariantBy('pv.gtin = $1', code)
    if (variant) return NextResponse.json({ kind: 'variant', code, item: variant })

    item = await findProductBy('p.gtin = $1', code)
    if (item) return NextResponse.json({ kind: 'product', code, item })

    // 4. Serial number → the physical unit + its product + status
    const serial = await queryOne<any>(
      `SELECT ps.id AS serial_id, ps.serial_number, ps.status, ps.order_id, ps.order_item_id,
              ps.product_id, ps.variant_id, ps.sub_variant_id, ps.batch_id,
              p.name AS product_name, p.sku AS product_sku, p.slug,
              pv.variant_name, pv.sku AS variant_sku
       FROM product_serials ps
       JOIN products p ON p.id = ps.product_id
       LEFT JOIN product_variants pv ON pv.id = ps.variant_id
       WHERE ps.serial_number = $1
       ORDER BY CASE ps.status WHEN 'in_stock' THEN 0 ELSE 1 END, ps.received_at DESC
       LIMIT 1`,
      [code]
    )
    if (serial) {
      // Attach the full priced product/variant `item` (same shape/columns as a
      // SKU scan) so a serial-scanned line gets pricing/GST/HSN/discount just like
      // a Name selection — the serial query alone has none of those. The `serial`
      // payload still carries status + serial_number for the client's checks.
      const base = serial.variant_id
        ? await findVariantBy('pv.id = $1', serial.variant_id)
        : await findProductBy('p.id = $1', serial.product_id)
      const item = base
        ? { ...base, sub_variant_id: serial.sub_variant_id ?? null }
        : undefined
      return NextResponse.json({ kind: 'serial', code, serial, item })
    }

    // 5. LOT / batch number → the batch's product/variant grain. Least-specific
    //    identifier, so matched last (before not_found). Returns a full product/
    //    variant `item` (so pricing/GST populate) plus the batch grain + lot info.
    const batch = await queryOne<any>(
      `SELECT pb.id AS batch_id, pb.lot_number, pb.expiry_date,
              pb.product_id, pb.variant_id, pb.sub_variant_id,
              COALESCE(pb.quantity_remaining, 0)::numeric AS quantity_remaining
       FROM product_batches pb
       WHERE pb.lot_number = $1
       ORDER BY pb.expiry_date ASC NULLS LAST, pb.received_at DESC
       LIMIT 1`,
      [code]
    )
    if (batch) {
      // Build the standard product/variant item so the client add-line path works
      // unchanged; then attach the batch grain (sub_variant_id) + lot info.
      const base = batch.variant_id
        ? await findVariantBy('pv.id = $1', batch.variant_id)
        : await findProductBy('p.id = $1', batch.product_id)
      if (base) {
        const item = {
          ...base,
          sub_variant_id: batch.sub_variant_id ?? null,
          lot_number: batch.lot_number,
          batch_id: batch.batch_id,
          batch_quantity_remaining: batch.quantity_remaining,
        }
        return NextResponse.json({ kind: 'batch', code, item })
      }
    }

    return NextResponse.json({ kind: 'not_found', code })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Resolve failed' }, { status: 500 })
  }
}
