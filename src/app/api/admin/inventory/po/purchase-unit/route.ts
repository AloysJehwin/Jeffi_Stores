import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Returns PO-line defaults for a (product/leaf, supplier):
//   - conversion: the remembered purchase-unit conversion (product_suppliers)
//   - baseUnit: the product's stored base/stock unit (product_units where is_base)
// so the PO builder can default the Base Unit + Purchase Unit + factor on pick.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  const productId = (sp.get('product_id') || '').trim()
  const variantId = (sp.get('variant_id') || '').trim() || null
  const subVariantId = (sp.get('sub_variant_id') || '').trim() || null
  const supplierId = (sp.get('supplier_id') || '').trim()

  if (!productId) return NextResponse.json({ conversion: null, baseUnit: null })

  try {
    // Stored base/stock unit (variant base wins when the line is a variant).
    const baseRow = await queryOne<{ unit: string; display_label: string | null; dimension: string }>(
      `SELECT unit, display_label, dimension
       FROM product_units
       WHERE product_id = $1 AND is_base = true
         AND variant_id IS NOT DISTINCT FROM $2::uuid
       ORDER BY (variant_id IS NOT NULL) DESC
       LIMIT 1`,
      [productId, variantId]
    )
    const baseUnit = baseRow
      ? { unit: baseRow.unit, label: baseRow.display_label || baseRow.unit, dimension: baseRow.dimension || 'count' }
      : null

    let conversion: { purchase_unit: string | null; purchase_unit_factor: number } | null = null
    if (supplierId) {
      const row = await queryOne<{ purchase_unit: string | null; purchase_unit_factor: string }>(
        `SELECT purchase_unit, purchase_unit_factor
         FROM product_suppliers
         WHERE product_id = $1
           AND variant_id IS NOT DISTINCT FROM $2::uuid
           AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
           AND supplier_id = $4
           AND is_active = true
           AND purchase_unit IS NOT NULL
         ORDER BY effective_date DESC, created_at DESC
         LIMIT 1`,
        [productId, variantId, subVariantId, supplierId]
      )
      if (row)
        conversion = { purchase_unit: row.purchase_unit, purchase_unit_factor: Number(row.purchase_unit_factor) || 1 }
    }

    return NextResponse.json({ conversion, baseUnit })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
