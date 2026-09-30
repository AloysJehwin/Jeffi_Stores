import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

async function getAllDraftSubVariants(productId: string): Promise<any[]> {
  const row = await queryOne<{ sub_variants: any[] }>(`SELECT sub_variants FROM product_drafts WHERE product_id = $1`, [
    productId,
  ])
  return Array.isArray(row?.sub_variants) ? row!.sub_variants : []
}

// A variant is "touched" in the draft once it has ANY row (staged edit/add or a
// _cleared sentinel). The draft column is meant to be a COMPLETE snapshot per
// touched variant — not a sparse override list — so read-back and publish can
// treat it as authoritative. Seeding on first touch is what makes that true.
function variantTouched(all: any[], variantId: string): boolean {
  return all.some((sv: any) => sv.variant_id === variantId)
}

// On the first mutation of a variant in draft mode, copy its FULL live sub-variant
// set (created_at order) into the draft array so siblings aren't lost and order is
// stable. Live rows are tagged `_seeded` so publish knows the whole set is staged.
async function ensureVariantSeeded(productId: string, variantId: string, all: any[]): Promise<any[]> {
  if (variantTouched(all, variantId)) return all
  const live = await queryMany<any>(
    `SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`,
    [variantId]
  )
  if (!live.length) return all
  return [...all, ...live.map(sv => ({ ...sv, _seeded: true }))]
}

// GET — return the complete sub-variant set for a variant. If the variant has been
// touched in the draft, the draft holds the full snapshot (seeded on first edit);
// otherwise fall back to the live rows.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })

  const all = await getAllDraftSubVariants(id)
  const touched = variantTouched(all, variantId)

  if (!touched) {
    // Untouched in this draft → return the live rows.
    const live = await queryMany(`SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`, [
      variantId,
    ])
    return NextResponse.json({ sub_variants: live })
  }

  // Touched → the draft is the complete snapshot for this variant. Return every
  // non-cleared row in stored order (seeded live rows + staged edits/adds).
  const draftSvs = all.filter((sv: any) => !sv._cleared && sv.variant_id === variantId)
  return NextResponse.json({ sub_variants: draftSvs })
}

// POST — add a sub-variant. Seed the variant's full set first so the draft stays
// a complete snapshot, then append the new draft row.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })

  const body = await req.json()
  let all = await getAllDraftSubVariants(id)
  all = await ensureVariantSeeded(id, variantId, all)
  const newSv = {
    ...body,
    id: `draft-sv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    variant_id: variantId,
  }
  const updated = [...all, newSv]
  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    id,
    JSON.stringify(updated),
  ])
  return NextResponse.json({ sub_variant: newSv }, { status: 201 })
}

// DELETE — remove a sub-variant. Seed first so siblings survive, then drop the row
// (live rows also leave a _cleared sentinel so publish deletes them).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  const { id: svId } = await req.json()
  let all = await getAllDraftSubVariants(id)
  if (variantId) all = await ensureVariantSeeded(id, variantId, all)
  const filtered = all.filter((sv: any) => sv.id !== svId)

  // Add a cleared sentinel for live sub-variants (real UUID ids) so publish deletes
  // them; draft-sv- rows are just dropped.
  if (!String(svId).startsWith('draft-sv-')) {
    filtered.push({ _cleared: true, id: `cleared-sv-${Date.now()}`, variant_id: variantId, original_id: svId })
  }

  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    id,
    JSON.stringify(filtered),
  ])
  return NextResponse.json({ success: true })
}

// PATCH — edit a sub-variant. Seed first so the row is present, then update it in
// place by id (never append a lone live row again).
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  const body = await req.json()
  const { id: svId, ...updates } = body
  let all = await getAllDraftSubVariants(id)
  if (variantId) all = await ensureVariantSeeded(id, variantId, all)
  const idx = all.findIndex((sv: any) => sv.id === svId)

  let updated: any[]
  if (idx >= 0) {
    // Merge the edit onto the existing (seeded or staged) row; mark it edited so
    // publish reliably detects a change even for an unchanged-id live row.
    updated = all.map((sv: any) => (sv.id === svId ? { ...sv, ...updates, _edited: true } : sv))
  } else {
    // Row not found even after seeding (e.g. a brand-new id from the client) — add it.
    updated = [...all, { ...body, variant_id: variantId, _edited: true }]
  }

  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    id,
    JSON.stringify(updated),
  ])
  return NextResponse.json({ sub_variant: updated.find((sv: any) => sv.id === svId) })
}
