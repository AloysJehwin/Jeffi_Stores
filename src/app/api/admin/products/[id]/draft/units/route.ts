import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query, queryMany } from '@/lib/db'
import { assertUnitChangeAllowed, changedUnitFields } from '@/lib/selling-unit'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

// Live base unit at a scope, or null. Used to detect a real base-unit CHANGE so
// the block only fires when load-bearing fields differ from what stock was recorded under.
async function liveBaseUnit(productId: string, variantId: string | null, subVariantId: string | null) {
  return queryOne<{ unit: string; factor: string; dimension: string; qty_step: string; display_label: string | null }>(
    `SELECT unit, factor::text, dimension, qty_step::text, display_label
       FROM product_units
      WHERE product_id = $1 AND is_base = true
        AND variant_id IS NOT DISTINCT FROM $2::uuid
        AND sub_variant_id IS NOT DISTINCT FROM $3::uuid
      LIMIT 1`,
    [productId, variantId, subVariantId]
  )
}

async function getAllDraftUnits(productId: string): Promise<any[]> {
  const row = await queryOne<{ units: any[] }>(
    `SELECT units FROM product_drafts WHERE product_id = $1`, [productId]
  )
  return Array.isArray(row?.units) ? row!.units : []
}

function scopeMatch(u: any, variantId: string | null, subVariantId: string | null): boolean {
  if (subVariantId) return u.sub_variant_id === subVariantId
  if (variantId) return u.variant_id === variantId && !u.sub_variant_id
  return !u.variant_id && !u.sub_variant_id
}

// GET — return units for this scope from draft.units JSONB,
// falling back to live product_units if the draft has none for this scope
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  const subVariantId = req.nextUrl.searchParams.get('sub_variant_id')

  const raw = await getAllDraftUnits(id)
  // Ensure stable ids
  let changed = false
  const all = raw.map((u: any, i: number) => {
    if (!u.id) { changed = true; return { ...u, id: `draft-unit-${i}` } }
    return u
  })
  if (changed) {
    await query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [id, JSON.stringify(all)])
  }

  let units = all.filter((u: any) => !u._cleared && scopeMatch(u, variantId, subVariantId))
  const wasCleared = all.some((u: any) => u._cleared && scopeMatch(u, variantId, subVariantId))

  // Only fall back to live product_units if this scope was never touched in the draft
  if (units.length === 0 && !wasCleared) {
    const liveUnits = await queryMany(
      `SELECT * FROM product_units WHERE product_id = $1
       AND ($2::uuid IS NULL OR variant_id = $2::uuid)
       AND ($3::uuid IS NULL OR sub_variant_id = $3::uuid)
       AND ($2::uuid IS NOT NULL OR variant_id IS NULL)
       AND ($3::uuid IS NOT NULL OR sub_variant_id IS NULL)`,
      [id, variantId || null, subVariantId || null]
    )
    units = liveUnits
  }

  const base = units.find((u: any) => u.is_base) ?? null
  return NextResponse.json({ units, inherited: false, rules: base ? [{ unit: (base as any).unit, dimension: (base as any).dimension }] : [] })
}

// POST — add a unit for this scope into draft.units JSONB
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  const subVariantId = req.nextUrl.searchParams.get('sub_variant_id')

  const body = await req.json()
  const override = body.override === true

  // Block a base-unit change when stock recorded under the current unit would be
  // reinterpreted — unless the admin overrides (which schedules a stock wipe on publish).
  if (body.is_base && !override) {
    const live = await liveBaseUnit(id, variantId || null, subVariantId || null)
    if (live) {
      const reason = await assertUnitChangeAllowed(
        { query },
        { productId: id, variantId: variantId || null, subVariantId: subVariantId || null, label: live.display_label || live.unit },
        changedUnitFields({ factor: body.factor, dimension: body.dimension, qty_step: body.qty_step }, live)
      )
      if (reason) return NextResponse.json({ error: reason, canOverride: true }, { status: 409 })
    }
  }

  const all = await getAllDraftUnits(id)
  const newUnit = {
    ...body,
    override: undefined,
    ...(override ? { _reset_stock_on_publish: true } : {}),
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    variant_id: variantId || null,
    sub_variant_id: subVariantId || null,
  }

  let updated: any[]
  if (body.is_base) {
    // Replace existing base unit in this scope
    const idx = all.findIndex((u: any) => u.is_base && scopeMatch(u, variantId, subVariantId))
    if (idx >= 0) { updated = [...all]; updated[idx] = newUnit }
    else updated = [...all, newUnit]
  } else {
    updated = [...all, newUnit]
  }

  await query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [id, JSON.stringify(updated)])
  return NextResponse.json({ success: true, unit: newUnit })
}

// DELETE — remove a unit by id from draft.units
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { unitId } = await req.json()
  const all = await getAllDraftUnits(id)
  const updated = all.filter((u: any) => u.id !== unitId)

  await query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [id, JSON.stringify(updated)])
  return NextResponse.json({ success: true })
}
