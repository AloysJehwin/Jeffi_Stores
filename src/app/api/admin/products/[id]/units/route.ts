import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, withTransaction, query } from '@/lib/shared/db'
import {
  validateSerializedUnitStep,
  assertUnitChangeAllowed,
  changedUnitFields,
  validateUnitQuantityBounds,
} from '@/lib/catalog/selling-unit'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

async function ensureProduct(productId: string) {
  const row = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId])
  return !!row
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await ensureProduct(id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const variantId = request.nextUrl.searchParams.get('variant_id')

  const units = await queryMany(
    variantId
      ? `SELECT id, product_id, variant_id, unit, factor, dimension, conversion_meta,
                is_base, display_label, notes, min_qty, max_qty, qty_step, created_at, updated_at
         FROM product_units
         WHERE product_id = $1 AND variant_id = $2
         ORDER BY is_base DESC, unit ASC`
      : `SELECT id, product_id, variant_id, unit, factor, dimension, conversion_meta,
                is_base, display_label, notes, min_qty, max_qty, qty_step, created_at, updated_at
         FROM product_units
         WHERE product_id = $1 AND variant_id IS NULL
         ORDER BY is_base DESC, unit ASC`,
    variantId ? [id, variantId] : [id]
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
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
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

  if (!(await ensureProduct(id))) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const isBase = !!body.is_base
  const displayLabel = body.display_label ? String(body.display_label).slice(0, 80) : null
  const notes = body.notes ? String(body.notes).slice(0, 500) : null
  const allowed = ['count', 'length', 'area', 'volume', 'weight', 'custom']
  const dimension = allowed.includes(body.dimension) ? body.dimension : 'count'
  const conversionMeta = body.conversion_meta != null ? body.conversion_meta : null
  const minQty =
    body.min_qty != null && Number.isFinite(Number(body.min_qty)) && Number(body.min_qty) > 0 ? Number(body.min_qty) : 1
  const maxQty =
    body.max_qty != null && Number.isFinite(Number(body.max_qty)) && Number(body.max_qty) >= minQty
      ? Number(body.max_qty)
      : null
  const qtyStep =
    body.qty_step != null && Number.isFinite(Number(body.qty_step)) && Number(body.qty_step) > 0
      ? Number(body.qty_step)
      : 1

  // min/max must be reachable multiples of qty_step, or the advertised bounds
  // describe quantities nobody can actually order.
  const boundsErr = validateUnitQuantityBounds({ qty_step: qtyStep, min_qty: minQty, max_qty: maxQty })
  if (boundsErr) return NextResponse.json({ error: boundsErr }, { status: 400 })

  // Serialized products need a whole-number qty_step so each step maps to one serial.
  const serialRow = await queryOne<{ serialized: boolean }>(`SELECT serialized FROM products WHERE id = $1`, [id])
  if (serialRow?.serialized) {
    const stepErr = validateSerializedUnitStep(qtyStep)
    if (stepErr) return NextResponse.json({ error: stepErr }, { status: 400 })
  }

  // An upsert on an existing unit overwrites factor/dimension/qty_step, so it is a
  // change like any other — refuse it when stock was recorded under the old values.
  const existingUnit = await queryOne<{ unit: string; factor: string; dimension: string; qty_step: string }>(
    `SELECT unit, factor::text, dimension, qty_step::text FROM product_units WHERE product_id = $1 AND unit = $2 AND variant_id IS NULL AND sub_variant_id IS NULL`,
    [id, unit]
  )
  if (existingUnit) {
    const guardErr = await assertUnitChangeAllowed(
      { query },
      { productId: id, variantId: null, subVariantId: null, label: unit },
      changedUnitFields({ factor, dimension, qty_step: qtyStep }, existingUnit)
    )
    if (guardErr) return NextResponse.json({ error: guardErr }, { status: 409 })
  }

  try {
    const inserted = await withTransaction(async client => {
      // Clear product-level flags first if needed (variant-level rows are
      // independent — their flag uniqueness is scoped per variant).
      if (isBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE product_id = $1 AND variant_id IS NULL`, [
          id,
        ])
      }
      const res = await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, dimension, conversion_meta,
           is_base, display_label, notes, min_qty, max_qty, qty_step
         ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (product_id, unit) WHERE variant_id IS NULL
         DO UPDATE SET
           factor = EXCLUDED.factor,
           dimension = EXCLUDED.dimension,
           conversion_meta = EXCLUDED.conversion_meta,
           is_base = EXCLUDED.is_base,
           display_label = EXCLUDED.display_label,
           notes = EXCLUDED.notes,
           min_qty = EXCLUDED.min_qty,
           max_qty = EXCLUDED.max_qty,
           qty_step = EXCLUDED.qty_step,
           updated_at = NOW()
         RETURNING *`,
        [
          id,
          unit,
          factor,
          dimension,
          conversionMeta ? JSON.stringify(conversionMeta) : null,
          isBase,
          displayLabel,
          notes,
          minQty,
          maxQty,
          qtyStep,
        ]
      )
      const row = res.rows[0]
      if (isBase) {
        await client.query(`UPDATE products SET sell_unit_id = $1 WHERE id = $2`, [row.id, id])
      }
      return row
    })
    return NextResponse.json({ unit: inserted })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'A unit with this name already exists for this product' }, { status: 409 })
    }
    return NextResponse.json({ error: msg || 'Failed to create unit' }, { status: 500 })
  }
}
