import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; variantId: string }>
}

async function ensureVariant(productId: string, variantId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
    [variantId, productId]
  )
  return !!row
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (!(await ensureVariant(id, variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }

  const variantUnits = await queryMany(
    `SELECT id, product_id, variant_id, sub_variant_id, unit, factor, dimension, conversion_meta,
            is_base, display_label, notes, min_qty, max_qty, qty_step,
            created_at, updated_at
     FROM product_units
     WHERE variant_id = $1
     ORDER BY is_base DESC, unit ASC`,
    [variantId]
  )

  // If no variant-specific rows, fall back to product-level units (inherited)
  const inherited = variantUnits.length === 0
  const units = inherited
    ? await queryMany(
        `SELECT id, product_id, variant_id, sub_variant_id, unit, factor, dimension, conversion_meta,
                is_base, display_label, notes, min_qty, max_qty, qty_step,
                created_at, updated_at
         FROM product_units
         WHERE product_id = $1 AND variant_id IS NULL
         ORDER BY is_base DESC, unit ASC`,
        [id]
      )
    : variantUnits

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

  return NextResponse.json({ units, rules, inherited })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
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

  if (!(await ensureVariant(id, variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }

  const isBase = !!body.is_base
  const displayLabel = body.display_label ? String(body.display_label).slice(0, 80) : null
  const notes = body.notes ? String(body.notes).slice(0, 500) : null
  const allowedDimensions = ['count', 'length', 'area', 'volume', 'weight', 'custom']
  const dimension = allowedDimensions.includes(body.dimension) ? body.dimension : 'count'
  const conversionMeta = body.conversion_meta != null ? body.conversion_meta : null
  const minQty = body.min_qty != null && Number.isFinite(Number(body.min_qty)) && Number(body.min_qty) > 0 ? Number(body.min_qty) : 1
  const maxQty = body.max_qty != null && Number.isFinite(Number(body.max_qty)) && Number(body.max_qty) >= minQty ? Number(body.max_qty) : null
  const qtyStep = body.qty_step != null && Number.isFinite(Number(body.qty_step)) && Number(body.qty_step) > 0 ? Number(body.qty_step) : 1

  try {
    const upserted = await withTransaction(async (client) => {
      if (isBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE variant_id = $1`, [variantId])
      }
      const res = await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, dimension, conversion_meta,
           is_base, display_label, notes, min_qty, max_qty, qty_step
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (variant_id, unit) WHERE variant_id IS NOT NULL
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
          variantId,
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
      return res.rows[0]
    })
    return NextResponse.json({ unit: upserted })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('uniq_product_units_one_base_per_variant')) {
      return NextResponse.json({ error: 'A base unit already exists for this variant' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 })
  }
}
