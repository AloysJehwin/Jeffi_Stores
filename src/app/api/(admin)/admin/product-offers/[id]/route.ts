import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(500).nullish(),
  badgeText: z.string().max(100).nullish(),
  badgeColor: z.string().max(30).nullish(),
  ctaLabel: z.string().max(100).nullish(),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  isActive: z.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
})

// Map camelCase request keys to snake_case DB columns.
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  slug: 'slug',
  subtitle: 'subtitle',
  badgeText: 'badge_text',
  badgeColor: 'badge_color',
  ctaLabel: 'cta_label',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  isActive: 'is_active',
  displayOrder: 'display_order',
}

// PATCH /api/admin/product-offers/[id] — update one offer (partial).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data as Record<string, unknown>

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const [key, col] of Object.entries(COLUMN_MAP)) {
    if (key in d) {
      sets.push(`${col} = $${i++}`)
      vals.push(d[key] ?? null)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  vals.push(id)

  await query(`UPDATE product_offers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  const offer = await queryOne(`SELECT * FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  return NextResponse.json({ offer })
}

// DELETE /api/admin/product-offers/[id] — remove the offer and its memberships.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await withTransaction(async client => {
    await client.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [id])
    await client.query(`DELETE FROM product_offers WHERE id = $1`, [id])
  })
  return NextResponse.json({ success: true })
}
