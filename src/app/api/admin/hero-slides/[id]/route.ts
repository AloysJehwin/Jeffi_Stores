import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'
import { applyDraftPatch, withHomepageDraft } from '@/lib/homepage-draft'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  subtitle: z.string().max(500).nullish(),
  badgeText: z.string().max(100).nullish(),
  badgeColor: z.string().max(30).nullish(),
  imageUrl: z.string().nullish(),
  imageUrlMobile: z.string().nullish(),
  ctaLabel: z.string().max(100).nullish(),
  ctaUrl: z.string().max(2000).nullish(),
  filterCategory: z.string().max(255).nullish(),
  filterBrand: z.string().max(255).nullish(),
  filterGrade: z.string().max(255).nullish(),
  filterMaterial: z.string().max(255).nullish(),
  filterMinPrice: z.coerce.number().min(0).nullish(),
  filterMaxPrice: z.coerce.number().min(0).nullish(),
  filterInStock: z.boolean().optional(),
  filterOnSale: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// Map camelCase request keys to snake_case DB columns.
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  subtitle: 'subtitle',
  badgeText: 'badge_text',
  badgeColor: 'badge_color',
  imageUrl: 'image_url',
  imageUrlMobile: 'image_url_mobile',
  ctaLabel: 'cta_label',
  ctaUrl: 'cta_url',
  filterCategory: 'filter_category',
  filterBrand: 'filter_brand',
  filterGrade: 'filter_grade',
  filterMaterial: 'filter_material',
  filterMinPrice: 'filter_min_price',
  filterMaxPrice: 'filter_max_price',
  filterInStock: 'filter_in_stock',
  filterOnSale: 'filter_on_sale',
  isActive: 'is_active',
}

// PATCH /api/admin/hero-slides/[id] — update one draft slide (partial).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  for (const [key, col] of Object.entries(COLUMN_MAP)) {
    if (key in d) updates[col] = d[key] ?? null
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const slide = await withHomepageDraft(admin.adminId, draft => {
    const row = draft.heroSlides.find(s => s.id === id)
    if (row) applyDraftPatch(row, updates)
    return row ?? null
  })
  if (!slide) return NextResponse.json({ error: 'Slide not found' }, { status: 404 })
  return NextResponse.json({ slide })
}

// DELETE /api/admin/hero-slides/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await withHomepageDraft(admin.adminId, draft => {
    draft.heroSlides = draft.heroSlides.filter(s => s.id !== id)
  })
  return NextResponse.json({ success: true })
}
