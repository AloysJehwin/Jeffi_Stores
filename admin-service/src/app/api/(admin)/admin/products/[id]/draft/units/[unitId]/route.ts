import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query, queryMany } from '@/lib/shared/db'
import { assertUnitChangeAllowed, changedUnitFields } from '@/lib/catalog/selling-unit'
import { actorOf, draftLockResponse, epochFrom, withDraftWrite } from '@/lib/admin/draft-locks'
import { productDraftIdFor } from '@/lib/catalog/product-draft-id'

// Write the units column under the draft lock: a 423 response when someone else holds the draft.
async function saveUnits(
  req: NextRequest,
  admin: { adminId?: string; role?: string; scopes?: string[] },
  draftId: string | null,
  units: unknown[]
): Promise<NextResponse | null> {
  if (!draftId) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  try {
    await withDraftWrite(
      actorOf(admin),
      'product',
      draftId,
      db =>
        db.query(`UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
          draftId,
          JSON.stringify(units),
        ]),
      { epoch: epochFrom(req), assertAfter: true }
    )
    return null
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
}

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; unitId: string }>
}

async function getDraftUnits(draftId: string | null): Promise<any[]> {
  if (!draftId) return []
  const row = await queryOne<{ units: any[] }>(`SELECT units FROM product_drafts WHERE id = $1`, [draftId])
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
  const draftId = await productDraftIdFor(req, id, admin.adminId)
  const units = await getDraftUnits(draftId)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
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
  // Making a unit the default: one default per scope. A scope still showing live units is copied into the
  // draft first so the old default is demoted rather than dropped on publish.
  if (body.is_base === true) {
    const vId = (existing?.variant_id ?? req.nextUrl.searchParams.get('variant_id')) || null
    const svId = (existing?.sub_variant_id ?? req.nextUrl.searchParams.get('sub_variant_id')) || null
    const inScope = (u: any) =>
      svId
        ? u.sub_variant_id === svId
        : vId
          ? u.variant_id === vId && !u.sub_variant_id
          : !u.variant_id && !u.sub_variant_id
    let all = units
    if (!all.some((u: any) => !u._cleared && inScope(u))) {
      const live = await queryMany<any>(
        `SELECT * FROM product_units WHERE product_id = $1
           AND variant_id IS NOT DISTINCT FROM $2::uuid AND sub_variant_id IS NOT DISTINCT FROM $3::uuid`,
        [id, vId, svId]
      )
      all = [...all.filter((u: any) => !inScope(u)), ...live]
    }
    updated = all.map((u: any) =>
      u.id === unitId ? { ...u, ...patch, is_base: true } : inScope(u) ? { ...u, is_base: false } : u
    )
    if (!updated.some((u: any) => u.id === unitId))
      updated.push({ ...patch, id: unitId, variant_id: vId, sub_variant_id: svId })
  } else if (idx >= 0) {
    updated = units.map((u: any) => (u.id === unitId ? { ...u, ...patch } : u))
  } else {
    // Unit not in draft yet — add it with this id
    updated = [...units, { ...patch, id: unitId }]
  }
  const locked = await saveUnits(req, admin, draftId, updated)
  if (locked) return locked
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
  const draftId = await productDraftIdFor(req, id, admin.adminId)

  // Get scope from query params (needed when unit came from live fallback and has no draft entry)
  const variantId = req.nextUrl.searchParams.get('variant_id')
  const subVariantId = req.nextUrl.searchParams.get('sub_variant_id')
  const override = req.nextUrl.searchParams.get('override') === 'true'

  const units = await getDraftUnits(draftId)
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

  const locked = await saveUnits(req, admin, draftId, filtered)
  if (locked) return locked
  return NextResponse.json({ success: true })
}
