import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { findOpenSession } from '@/lib/admin/editor-sessions'
import { ensureOfferDraft } from '@/lib/admin/offer-drafts'

export const dynamic = 'force-dynamic'

// Absolute (S3/CDN) or a site path such as /images/...
const mediaUrl = z.string().max(2000).regex(/^(https?:\/\/|\/(?!\/))/, 'Expected a URL').nullish()
const blurhash = z.string().max(64).nullish()

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
  imageUrl: mediaUrl,
  imageUrlCard: mediaUrl,
  blurhash,
  blurhashCard: blurhash,
  videoUrl: mediaUrl,
  videoUrlCard: mediaUrl,
})

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

// Media goes straight to the live row in both paths, like the image upload and generate routes:
// the publish step copies only the copy fields above.
const MEDIA_COLUMNS: Record<string, string> = {
  imageUrl: 'image_url',
  imageUrlCard: 'image_url_card',
  blurhash: 'blurhash',
  blurhashCard: 'blurhash_card',
  videoUrl: 'video_url',
  videoUrlCard: 'video_url_card',
}

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
  const touched = Object.entries(COLUMN_MAP).filter(([key]) => key in d)
  const media = Object.entries(MEDIA_COLUMNS).filter(([key]) => key in d)
  if (touched.length === 0 && media.length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  if (media.length > 0) {
    const sets = media.map(([, col], i) => `${col} = $${i + 1}`)
    const res = await query(
      `UPDATE product_offers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${media.length + 1}`,
      [...media.map(([key]) => d[key] ?? null), id]
    )
    if (!res.rowCount) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    if (touched.length === 0)
      return NextResponse.json({ offer: await queryOne(`SELECT * FROM product_offers WHERE id = $1`, [id]) })
  }

  const session = await findOpenSession(admin.adminId, 'offer', id)

  if (session) {
    // Draft path — merge the patch into offer_drafts.fields.
    await ensureOfferDraft(id)
    const patchJson: Record<string, unknown> = {}
    for (const [key, col] of touched) patchJson[col] = d[key] ?? null
    await query(
      `UPDATE offer_drafts SET fields = fields || $1::jsonb, updated_at = now()
       WHERE offer_id = $2`,
      [JSON.stringify(patchJson), id]
    )
    const row = await queryOne(`SELECT * FROM offer_drafts WHERE offer_id = $1`, [id])
    return NextResponse.json({ draft: row })
  }

  // Legacy path — commit directly to live row (non-editor callers like homepage picker).
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const [key, col] of touched) {
    sets.push(`${col} = $${i++}`)
    vals.push(d[key] ?? null)
  }
  vals.push(id)
  await query(`UPDATE product_offers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  const offer = await queryOne(`SELECT * FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  return NextResponse.json({ offer })
}

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
