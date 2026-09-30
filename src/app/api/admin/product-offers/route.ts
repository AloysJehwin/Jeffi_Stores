import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'
import { listOffersAdmin, slugifyOffer } from '@/lib/product-offers'

export const dynamic = 'force-dynamic'

// GET /api/admin/product-offers — list all offers with product counts.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const offers = await listOffersAdmin()
  return NextResponse.json({ offers })
}

const bodySchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(200).nullish(),
  subtitle: z.string().max(500).nullish(),
  badgeText: z.string().max(100).nullish(),
  badgeColor: z.string().max(30).nullish(),
  ctaLabel: z.string().max(100).nullish(),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  isActive: z.boolean().optional(),
})

// POST /api/admin/product-offers — create an offer (appended to the end).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(bodySchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const offer = await withTransaction(async client => {
    const orderRow = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM product_offers`
    )
    const nextOrder = orderRow.rows[0]?.next ?? 0

    const base = d.slug && d.slug.trim() ? slugifyOffer(d.slug) : slugifyOffer(d.title)
    let slug = base
    for (let n = 2; ; n++) {
      const clash = await client.query<{ id: string }>(`SELECT id FROM product_offers WHERE slug = $1`, [slug])
      if (clash.rows.length === 0) break
      slug = `${base}-${n}`
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_offers
         (slug, title, subtitle, badge_text, badge_color, cta_label,
          starts_at, ends_at, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        slug,
        d.title,
        d.subtitle ?? null,
        d.badgeText ?? null,
        d.badgeColor ?? null,
        d.ctaLabel ?? null,
        d.startsAt ?? null,
        d.endsAt ?? null,
        nextOrder,
        d.isActive ?? true,
      ]
    )
    const id = inserted.rows[0]?.id
    const row = await client.query(`SELECT * FROM product_offers WHERE id = $1`, [id])
    return row.rows[0]
  })

  return NextResponse.json({ offer })
}

const reorderSchema = z.object({ order: z.array(zUuid).min(1) })

// PATCH /api/admin/product-offers — set display_order from the given id sequence.
export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(reorderSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const ids = Array.from(new Set(parsed.data.order))

  await withTransaction(async client => {
    for (let i = 0; i < ids.length; i++) {
      await client.query(`UPDATE product_offers SET display_order = $1, updated_at = NOW() WHERE id = $2`, [i, ids[i]])
    }
  })

  return NextResponse.json({ success: true })
}
