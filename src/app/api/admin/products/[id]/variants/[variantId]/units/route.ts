import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query, withTransaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: { id: string; variantId: string }
}

async function ensureVariant(productId: string, variantId: string) {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
    [variantId, productId]
  )
  return !!row
}

export async function GET(request: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (!(await ensureVariant(params.id, params.variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }

  const units = await queryMany(
    `SELECT id, product_id, variant_id, unit, factor, dimension, conversion_meta,
            is_base, is_purchase_default, is_sell_default,
            price_override, display_label, notes,
            created_at, updated_at
     FROM product_units
     WHERE variant_id = $1
     ORDER BY is_base DESC, unit ASC`,
    [params.variantId]
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

  if (!(await ensureVariant(params.id, params.variantId))) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
  }

  const isBase = !!body.is_base
  const isSellDefault = !!body.is_sell_default
  const isPurchaseDefault = !!body.is_purchase_default
  const priceOverride = body.price_override == null || body.price_override === ''
    ? null
    : Number(body.price_override)
  if (priceOverride != null && !Number.isFinite(priceOverride)) {
    return NextResponse.json({ error: 'price_override must be a number' }, { status: 400 })
  }
  const displayLabel = body.display_label ? String(body.display_label).slice(0, 80) : null
  const notes = body.notes ? String(body.notes).slice(0, 500) : null
  const allowedDimensions = ['count', 'length', 'area', 'volume', 'weight', 'custom']
  const dimension = allowedDimensions.includes(body.dimension) ? body.dimension : 'count'
  const conversionMeta = body.conversion_meta != null ? body.conversion_meta : null

  try {
    const inserted = await withTransaction(async (client) => {
      if (isBase) {
        await client.query(`UPDATE product_units SET is_base = FALSE WHERE variant_id = $1`, [params.variantId])
      }
      if (isSellDefault) {
        await client.query(`UPDATE product_units SET is_sell_default = FALSE WHERE variant_id = $1`, [params.variantId])
      }
      if (isPurchaseDefault) {
        await client.query(`UPDATE product_units SET is_purchase_default = FALSE WHERE variant_id = $1`, [params.variantId])
      }
      const res = await client.query(
        `INSERT INTO product_units (
           product_id, variant_id, unit, factor, dimension, conversion_meta,
           is_base, is_sell_default, is_purchase_default,
           price_override, display_label, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          params.id,
          params.variantId,
          unit,
          factor,
          dimension,
          conversionMeta ? JSON.stringify(conversionMeta) : null,
          isBase,
          isSellDefault,
          isPurchaseDefault,
          priceOverride,
          displayLabel,
          notes,
        ]
      )
      return res.rows[0]
    })
    return NextResponse.json({ unit: inserted })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('uniq_product_units_one_base_per_variant') || msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'A unit with this name already exists for this variant' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 })
  }
}
