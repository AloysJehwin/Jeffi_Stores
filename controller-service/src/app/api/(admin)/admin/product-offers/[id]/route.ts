import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { offerDrafts, offerFieldsOf } from '@/lib/admin/offer-drafts'
import { recordDirectRevision } from '@/lib/admin/entity-revisions'
import { actorOf, closeIfLocked, discardGuard, draftLockResponse, epochFrom, withDraftWrite } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

// Absolute (S3/CDN) or a site path such as /images/...
const mediaUrl = z
  .string()
  .max(2000)
  .regex(/^(https?:\/\/|\/(?!\/))/, 'Expected a URL')
  .nullish()
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

  const actor = actorOf(admin)
  // ?draft=<id>: copy fields go to that draft. Media always goes to the live row.
  const draftId = request.nextUrl.searchParams.get('draft')
  if (draftId && touched.length > 0) {
    const draft = await getDraftRow(offerDrafts, draftId)
    if (!draft || draft.offer_id !== id) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

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

  if (draftId) {
    // Draft path — merge the patch into offer_drafts.fields.
    const patchJson: Record<string, unknown> = {}
    for (const [key, col] of touched) patchJson[col] = d[key] ?? null
    try {
      const row = await withDraftWrite(
        actor,
        'offer',
        draftId,
        async db =>
          (
            await db.query(
              `UPDATE offer_drafts SET fields = fields || $1::jsonb, updated_at = now()
               WHERE id = $2 RETURNING *`,
              [JSON.stringify(patchJson), draftId]
            )
          ).rows[0] ?? null,
        { epoch: epochFrom(request), ensure: true }
      )
      return NextResponse.json({ draft: row })
    } catch (err) {
      const locked = draftLockResponse(err)
      if (locked) return locked
      throw err
    }
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
  // Before and after in one statement, so drafts open on this offer see who changed what.
  const res = await query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
    `WITH old AS (SELECT * FROM product_offers WHERE id = $${i} FOR UPDATE)
     UPDATE product_offers po SET ${sets.join(', ')}, updated_at = NOW() FROM old WHERE po.id = old.id
     RETURNING to_jsonb(old) AS before, to_jsonb(po) AS after`,
    vals
  )
  const changed = res.rows[0]
  if (changed)
    await recordDirectRevision({ type: 'offer', id, before: offerFieldsOf(changed.before), after: offerFieldsOf(changed.after), actorAdminId: admin.adminId })
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
  const actor = actorOf(admin)
  // Deleting the offer drops its drafts: not while someone else holds one (owners may).
  const drafts = await draftsOf(offerDrafts, id)
  for (const dr of drafts) {
    const denied = await discardGuard(actor, 'offer', dr.id)
    if (denied) return denied
  }
  await withTransaction(async client => {
    await client.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [id])
    await client.query(`DELETE FROM product_offers WHERE id = $1`, [id])
  })
  for (const dr of drafts) await closeIfLocked(actor, 'offer', dr.id)
  return NextResponse.json({ success: true })
}
