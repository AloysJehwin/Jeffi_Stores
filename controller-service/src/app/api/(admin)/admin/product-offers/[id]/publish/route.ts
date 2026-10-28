import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { findOpenSession, saveSession } from '@/lib/admin/editor-sessions'
import { actorOf, draftLockResponse, epochFrom } from '@/lib/admin/draft-locks'
import { draftConflictResponse, getDraftRow } from '@/lib/admin/draft-branches'
import { offerDrafts, publishOfferDraft } from '@/lib/admin/offer-drafts'

export const dynamic = 'force-dynamic'

// POST ?draft=<id> { resolutions? } — merge the draft into live; 409 lists overlapping edits.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const draftId = request.nextUrl.searchParams.get('draft') ?? body?.draftId
  if (!draftId) return NextResponse.json({ error: 'Missing draft' }, { status: 400 })
  const draft = await getDraftRow(offerDrafts, draftId)
  if (!draft || draft.offer_id !== id) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  let revision: number | null = null
  try {
    revision = (await publishOfferDraft(draftId, { actor: actorOf(admin), resolutions: body?.resolutions, epoch: epochFrom(request) })).revision
  } catch (err) {
    const handled = draftLockResponse(err) ?? draftConflictResponse(err)
    if (handled) return handled
    throw err
  }

  // The draft is gone: close the editor's session as saved.
  const session = await findOpenSession(admin.adminId, 'offer', draftId)
  if (session) await saveSession(session.id, admin.adminId)

  const row = await queryOne(`SELECT * FROM product_offers WHERE id = $1`, [id])
  return NextResponse.json({ offer: row, revision })
}
