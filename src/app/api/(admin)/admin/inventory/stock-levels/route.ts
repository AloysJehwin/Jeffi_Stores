import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

const STOCK_LEVELS_SQL = `
  WITH skus AS (
    SELECT
      COALESCE(p.inventory_quantity, 0) AS qty,
      p.low_stock_threshold AS threshold
    FROM products p
    WHERE p.has_variants = FALSE AND p.is_active = TRUE
    UNION ALL
    SELECT
      COALESCE(pv.inventory_quantity, 0) AS qty,
      p.low_stock_threshold AS threshold
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE p.is_active = TRUE AND pv.is_active = TRUE
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = TRUE)
    UNION ALL
    SELECT
      COALESCE(sv.inventory_quantity, 0) AS qty,
      p.low_stock_threshold AS threshold
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE p.is_active = TRUE AND pv.is_active = TRUE AND sv.is_active = TRUE
  )
  SELECT
    COUNT(*) FILTER (WHERE qty <= 0) AS out_of_stock,
    COUNT(*) FILTER (WHERE qty > 0 AND threshold IS NOT NULL AND qty <= threshold) AS low_stock
  FROM skus
`

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'inventory:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const row = await queryOne<{ out_of_stock: string; low_stock: string }>(STOCK_LEVELS_SQL)

    return NextResponse.json({
      out_of_stock: Number(row?.out_of_stock) || 0,
      low_stock: Number(row?.low_stock) || 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
