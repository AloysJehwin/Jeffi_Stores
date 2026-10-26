import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { findOpenSession, saveSession } from '@/lib/admin/editor-sessions'
import {
  actorOf,
  announceDraftClosed,
  assertDraftHolder,
  closeDraftLockTx,
  draftLockResponse,
  epochFrom,
} from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

const EDITABLE_COLUMNS = [
  'title',
  'slug',
  'subtitle',
  'badge_text',
  'badge_color',
  'cta_label',
  'starts_at',
  'ends_at',
  'is_active',
  'display_order',
] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const session = await findOpenSession(admin.adminId, 'offer', id)
  if (!session) {
    return NextResponse.json({ error: 'No open edit session' }, { status: 400 })
  }

  const draft = await queryOne<{ fields: Record<string, unknown> | null; products: string[] | null }>(
    `SELECT fields, products FROM offer_drafts WHERE offer_id = $1`,
    [id]
  )

  const actor = actorOf(admin)
  let closed = null
  try {
    await withTransaction(async client => {
      await assertDraftHolder(client, actor, 'offer', id, { epoch: epochFrom(request) })
      if (draft?.fields) {
        const touched = EDITABLE_COLUMNS.filter(c => c in (draft.fields as object))
        if (touched.length > 0) {
          const sets = touched.map((c, i) => `${c} = $${i + 1}`)
          const vals = touched.map(c => (draft.fields as Record<string, unknown>)[c])
          vals.push(id)
          await client.query(
            `UPDATE product_offers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${touched.length + 1}`,
            vals
          )
        }
      }
      if (draft?.products) {
        await client.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [id])
        if (draft.products.length > 0) {
          await client.query(
            `INSERT INTO product_offer_items (offer_id, product_id)
             SELECT $1, pid FROM unnest($2::uuid[]) AS pid
           ON CONFLICT DO NOTHING`,
            [id, draft.products]
          )
        }
      }
      await client.query(`DELETE FROM offer_drafts WHERE offer_id = $1`, [id])
      closed = await closeDraftLockTx(client, actor, 'offer', id, 'published')
    })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  await announceDraftClosed(actor, 'offer', id, closed, 'published')

  await saveSession(session.id, admin.adminId)

  const row = await queryOne(`SELECT * FROM product_offers WHERE id = $1`, [id])
  return NextResponse.json({ offer: row })
}
