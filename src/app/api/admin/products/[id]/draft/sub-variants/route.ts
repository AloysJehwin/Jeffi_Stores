import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

async function getAllDraftSubVariants(productId: string): Promise<any[]> {
  const row = await queryOne<{ sub_variants: any[] }>(
    `SELECT sub_variants FROM product_drafts WHERE product_id = $1`, [productId]
  )
  return Array.isArray(row?.sub_variants) ? row!.sub_variants : []
}

// GET — return sub-variants for a specific variant from draft.sub_variants
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
  // Filter by variant_id — also check if we should fall back to live DB
  const draftSvs = all.filter((sv: any) => !sv._cleared && sv.variant_id === variantId)
  const wasCleared = all.some((sv: any) => sv._cleared && sv.variant_id === variantId)

  if (draftSvs.length === 0 && !wasCleared) {
    // Fall back to live product_sub_variants for this variant
    const { queryMany } = await import('@/lib/db')
    const live = await queryMany(
      `SELECT * FROM product_sub_variants WHERE variant_id = $1 ORDER BY created_at ASC`,
      [variantId]
    )
    return NextResponse.json({ sub_variants: live })
  }

  return NextResponse.json({ sub_variants: draftSvs })
}

// POST — add a sub-variant to draft.sub_variants
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
  const all = await getAllDraftSubVariants(id)
  const newSv = {
    ...body,
    id: `draft-sv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    variant_id: variantId,
  }
  const updated = [...all, newSv]
  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(updated)])
  return NextResponse.json({ sub_variant: newSv }, { status: 201 })
}

// DELETE — remove a sub-variant from draft.sub_variants or mark cleared
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const variantId = req.nextUrl.searchParams.get('variant_id')
  const { id: svId } = await req.json()
  const all = await getAllDraftSubVariants(id)
  const deleted = all.find((sv: any) => sv.id === svId)
  const filtered = all.filter((sv: any) => sv.id !== svId)

  // Add cleared sentinel for live sub-variants (those with real UUID ids)
  if (!svId.startsWith('draft-sv-')) {
    filtered.push({ _cleared: true, id: `cleared-sv-${Date.now()}`, variant_id: variantId, original_id: svId })
  }

  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(filtered)])
  return NextResponse.json({ success: true })
}

// PATCH — update a sub-variant in draft.sub_variants
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
  const all = await getAllDraftSubVariants(id)
  const idx = all.findIndex((sv: any) => sv.id === svId)

  let updated: any[]
  if (idx >= 0) {
    updated = all.map((sv: any) => sv.id === svId ? { ...sv, ...updates } : sv)
  } else {
    // Sub-variant from live DB being edited for first time — add to draft
    updated = [...all, { ...body, variant_id: variantId }]
  }

  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(updated)])
  return NextResponse.json({ sub_variant: updated.find((sv: any) => sv.id === svId) })
}
