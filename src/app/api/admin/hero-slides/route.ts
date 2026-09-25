import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'
import {
  applyDraftOrder, getEditableHomepage, nextDisplayOrder, withHomepageDraft, type DraftHeroSlide,
} from '@/lib/homepage-draft'

export const dynamic = 'force-dynamic'

// GET /api/admin/hero-slides — list all slides (admin management view)
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { heroSlides } = await getEditableHomepage()
  return NextResponse.json({ slides: heroSlides })
}

const bodySchema = z.object({
  title: z.string().min(1).max(255),
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

// POST /api/admin/hero-slides — create a new slide in the draft (appended to the end).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(bodySchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const slide = await withHomepageDraft(admin.adminId, draft => {
    const now = new Date().toISOString()
    const row: DraftHeroSlide = {
      id: randomUUID(),
      title: d.title,
      subtitle: d.subtitle ?? null,
      badge_text: d.badgeText ?? null,
      badge_color: d.badgeColor ?? 'bg-primary-500',
      image_url: d.imageUrl ?? null,
      image_url_mobile: d.imageUrlMobile ?? null,
      blurhash: null,
      blurhash_mobile: null,
      cta_label: d.ctaLabel ?? null,
      cta_url: d.ctaUrl ?? null,
      filter_category: d.filterCategory ?? null,
      filter_brand: d.filterBrand ?? null,
      filter_grade: d.filterGrade ?? null,
      filter_material: d.filterMaterial ?? null,
      filter_min_price: d.filterMinPrice ?? null,
      filter_max_price: d.filterMaxPrice ?? null,
      filter_in_stock: d.filterInStock ?? false,
      filter_on_sale: d.filterOnSale ?? false,
      display_order: nextDisplayOrder(draft.heroSlides),
      is_active: d.isActive ?? true,
      created_at: now,
      updated_at: now,
    }
    draft.heroSlides.push(row)
    return row
  })

  return NextResponse.json({ slide })
}

// PATCH /api/admin/hero-slides — bulk reorder of the draft. Body: { order: [id1, id2, ...] }
export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const order: string[] = Array.isArray(body?.order) ? body.order : []
  if (order.length === 0) return NextResponse.json({ error: 'order[] required' }, { status: 400 })

  await withHomepageDraft(admin.adminId, draft => {
    draft.heroSlides = applyDraftOrder(draft.heroSlides, order)
  })
  return NextResponse.json({ success: true })
}
