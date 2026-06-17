import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

async function ensureProduct(productId: string) {
  const row = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId])
  return !!row
}

export async function GET(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureProduct(params.id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  // Product-level rows only (variant_id IS NULL).
  const units = await queryMany(
    `SELECT id, product_id, variant_id, unit, factor, dimension, conversion_meta,
            is_base, is_purchase_default, is_sell_default,
            display_label, notes, min_qty, max_qty, qty_step, created_at, updated_at
     FROM product_units
     WHERE product_id = $1 AND variant_id IS NULL
     ORDER BY is_base DESC, unit ASC`,
    [params.id]
  )

  const unitIds = units.map(u => u.id)
  const rules = unitIds.length
    ? await queryMany(
        `SELECT id, product_unit_id, rule_type, config, is_active, priority, created_at
         FROM product_unit_rules
         WHERE product_unit_id = ANY($1::uuid[])
         ORDER BY priority ASC`,
        [unitIds]
      )
    : []

  return NextResponse.json({ units, rules })
}

export async function POST(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const unit = String(body.unit || '').trim()
  const factor = Number(body.factor)
  if (!unit) return NextResponse.json({ error: 'unit is required' }, { status: 400 })
  if (!Number.isFinite(factor) || factor <= 0) {
    return NextResponse.json({ error: 'factor must be a positive number' }, { status: 400 })
  }

  if (!(await ensureProduct(params.id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const isBase = !!body.is_base
  const isSellDefault = !!body.is_sell_default
  const isPurchaseDefault = !!body.is_purchase_default
  const displayLabel = body.display_label ? String(body.display_label).slice(0, 80) : null
  const notes = body.notes ? String(body.notes).slice(0, 500) : null
  const allowed = ['count', 'length', 'area', 'volume', 'weight', 'custom']
  const dimension = allowed.includes(body.dimension) ? body.dimension : 'count'
  const conversionMeta = body.conversion_meta != null ? body.conversion_meta : null
  const minQty = body.min_qty != null && Number.isFinite(Number(body.min_qty)) && Number(body.min_qty) > 0 ? Number(body.min_qty) : 1
  const maxQty = body.max_qty != null && Number.isFinite(Number(body.max_qty)) && Number(body.max_qty) >= minQty ? Number(body.max_qty) : null
  const qtyStep = body.qty_step != null && Number.isFinite(Number(body.qty_step)) && Number(body.qty_step) > 0 ? Number(body.qty_step) : 1

  try {
    const inserted = await withTransaction(async (client) => {
      // Clear product-level flags first if needed (variant-level rows are
      // independent — their flag uniqueness is scoped per variant).
      if (isBase) {
        await client.query(
          `UPDATE product_units SET is_base = FALSE WHERE product_id = $1 AND variant_id IS NULL`,
          [params.id]
        )
      }
      if (isSellDefault) {
        await client.query(
          `UPDATE product_units SET is_sell_default = FALSE WHERE product_id = $1 AND variant_id IS NULL`,
          [params.id]
        )
      }
      if (isPurchaseDefault) {
        await client.query(
          `UPDATE product_units SET is_purchase_default = FALSE WHERE product_id = $1 AND variant_id IS NULL`,
          [params.id]
        )
      }
      const res = await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, dimension, conversion_meta,
           is_base, is_sell_default, is_purchase_default,
           display_label, notes, min_qty, max_qty, qty_step
         ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          params.id,
          unit, factor, dimension,
          conversionMeta ? JSON.stringify(conversionMeta) : null,
          isBase, isSellDefault, isPurchaseDefault,
          displayLabel, notes,
          minQty, maxQty, qtyStep,
        ]
      )
      return res.rows[0]
    })
    return NextResponse.json({ unit: inserted })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('uniq_product_units_product_unit') || msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'A unit with this name already exists for this product' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 })
  }
}
