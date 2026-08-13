import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne } from '@/lib/db'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'

export const dynamic = 'force-dynamic'

// GET /api/admin/hero-slides — list all slides (admin management view)
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const slides = await queryMany(`SELECT * FROM hero_slides ORDER BY display_order ASC, created_at ASC`)
  return NextResponse.json({ slides })
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

// POST /api/admin/hero-slides — create a new slide (appended to the end).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(bodySchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const orderRow = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM hero_slides`
  )
  const nextOrder = orderRow?.next ?? 0

  const row = await queryOne<{ id: string }>(
    `INSERT INTO hero_slides
       (title, subtitle, badge_text, badge_color, image_url, image_url_mobile,
        cta_label, cta_url, filter_category, filter_brand, filter_grade, filter_material,
        filter_min_price, filter_max_price, filter_in_stock, filter_on_sale,
        display_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      d.title, d.subtitle ?? null, d.badgeText ?? null, d.badgeColor ?? 'bg-primary-500',
      d.imageUrl ?? null, d.imageUrlMobile ?? null, d.ctaLabel ?? null, d.ctaUrl ?? null,
      d.filterCategory ?? null, d.filterBrand ?? null, d.filterGrade ?? null, d.filterMaterial ?? null,
      d.filterMinPrice ?? null, d.filterMaxPrice ?? null, d.filterInStock ?? false, d.filterOnSale ?? false,
      nextOrder, d.isActive ?? true,
    ]
  )

  const slide = await queryOne(`SELECT * FROM hero_slides WHERE id = $1`, [row?.id])
  return NextResponse.json({ slide })
}

// PATCH /api/admin/hero-slides — bulk reorder. Body: { order: [id1, id2, ...] }
export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const order: string[] = Array.isArray(body?.order) ? body.order : []
  if (order.length === 0) return NextResponse.json({ error: 'order[] required' }, { status: 400 })

  for (let i = 0; i < order.length; i++) {
    await query(`UPDATE hero_slides SET display_order = $1, updated_at = NOW() WHERE id = $2`, [i, order[i]])
  }
  return NextResponse.json({ success: true })
}
