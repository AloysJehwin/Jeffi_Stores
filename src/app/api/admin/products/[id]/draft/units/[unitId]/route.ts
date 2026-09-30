import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { assertUnitChangeAllowed, changedUnitFields } from '@/lib/catalog/selling-unit'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; unitId: string }>
}

async function getDraftUnits(productId: string): Promise<any[]> {
  const row = await queryOne<{ units: any[] }>(`SELECT units FROM product_drafts WHERE product_id = $1`, [productId])
  return Array.isArray(row?.units) ? row!.units : []
}

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

// PATCH — update a unit in draft.units by id
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const units = await getDraftUnits(id)
  const body = await req.json()
  const override = body.override === true
  const idx = units.findIndex((u: any) => u.id === unitId)
  const existing = idx >= 0 ? units[idx] : null
  const isBase = body.is_base ?? existing?.is_base ?? false

  if (isBase && !override) {
    const variantId = (existing?.variant_id ?? req.nextUrl.searchParams.get('variant_id')) || null
    const subVariantId = (existing?.sub_variant_id ?? req.nextUrl.searchParams.get('sub_variant_id')) || null
    const live = await liveBaseUnit(id, variantId, subVariantId)
    if (live) {
      const reason = await assertUnitChangeAllowed(
        { query },
        { productId: id, variantId, subVariantId, label: live.display_label || live.unit },
        changedUnitFields({ factor: body.factor, dimension: body.dimension, qty_step: body.qty_step }, live)
      )
      if (reason) return NextResponse.json({ error: reason, canOverride: true }, { status: 409 })
    }
  }

  const patch = { ...body, override: undefined, ...(override ? { _reset_stock_on_publish: true } : {}) }
  let updated: any[]
  if (idx >= 0) {
    updated = units.map((u: any) => (u.id === unitId ? { ...u, ...patch } : u))
  } else {
    // Unit not in draft yet — add it with this id
    updated = [...units, { ...patch, id: unitId }]
  }
  await query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    id,
    JSON.stringify(updated),
  ])
  return NextResponse.json({ success: true, unit: updated.find((u: any) => u.id === unitId) })
}

// DELETE — remove a unit from draft.units by id, storing a sentinel so GET knows it was explicitly cleared
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, unitId } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Get scope from query params (needed when unit came from live fallback and has no draft entry)
  const variantId = req.nextUrl.searchParams.get('variant_id')
  const subVariantId = req.nextUrl.searchParams.get('sub_variant_id')
  const override = req.nextUrl.searchParams.get('override') === 'true'

  const units = await getDraftUnits(id)
  const deleted = units.find((u: any) => u.id === unitId)
  const filtered = units.filter((u: any) => u.id !== unitId)

  // Store a sentinel so the GET fallback knows this scope was explicitly cleared
  // Use scope from the found unit, or from query params if unit came from live fallback
  const clearedVariantId = deleted?.variant_id ?? variantId ?? null
  const clearedSubVariantId = deleted?.sub_variant_id ?? subVariantId ?? null

  // Removing the base unit is a unit change: block it when stock exists, unless overridden.
  if (deleted?.is_base && !override) {
    const live = await liveBaseUnit(id, clearedVariantId, clearedSubVariantId)
    if (live) {
      const reason = await assertUnitChangeAllowed(
        { query },
        {
          productId: id,
          variantId: clearedVariantId,
          subVariantId: clearedSubVariantId,
          label: live.display_label || live.unit,
        },
        { remove: true }
      )
      if (reason) return NextResponse.json({ error: reason, canOverride: true }, { status: 409 })
    }
  }

  filtered.push({
    _cleared: true,
    ...(override ? { _reset_stock_on_publish: true } : {}),
    id: `cleared-${Date.now()}`,
    variant_id: clearedVariantId,
    sub_variant_id: clearedSubVariantId,
  })

  await query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    id,
    JSON.stringify(filtered),
  ])
  return NextResponse.json({ success: true })
}
