import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { actorOf, closeAfter, discardGuard, draftLockChips, draftLockResponse, epochFrom, withDraftWrite } from '@/lib/admin/draft-locks'
import { createDraft, discardDraftRow, draftConflictResponse, draftsOf, getDraftRow, saveDraftContent } from '@/lib/admin/draft-branches'
import { couponDrafts } from '@/lib/catalog/coupon-draft'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

async function guard(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) return { res: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
  return { admin }
}

/** The coupon's open drafts, with who holds each. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { admin, res } = await guard(req)
  if (!admin) return res
  const drafts = await draftsOf(couponDrafts, id)
  const locks = await draftLockChips('coupon', drafts.map(d => d.id), admin.adminId)
  return NextResponse.json({ drafts: drafts.map(d => ({ ...d, lock: locks[d.id] ?? null })) })
}

// POST — your draft of this coupon (a new one with { new: true }).
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { admin, res } = await guard(req)
  if (!admin) return res
  const body = await req.json().catch(() => ({}))
  if (!(await queryOne(`SELECT 1 FROM coupons WHERE id = $1`, [id]))) return NextResponse.json({ error: 'Coupon not found' }, { status: 404 })
  try {
    if (!body?.new) {
      const mine = (await draftsOf(couponDrafts, id)).find(d => d.authorId === admin.adminId)
      if (mine) return NextResponse.json({ success: true, couponId: id, draftId: mine.id, existing: true })
    }
    const draftId = await createDraft(couponDrafts, actorOf(admin), id, { title: typeof body?.title === 'string' ? body.title.slice(0, 120) : null })
    return NextResponse.json({ success: true, couponId: id, draftId })
  } catch (err) {
    const r = draftLockResponse(err) ?? draftConflictResponse(err)
    if (r) return r
    throw err
  }
}

// PATCH — autosave { draftId, fields, title? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { admin, res } = await guard(req)
  if (!admin) return res
  const body = await req.json().catch(() => null)
  const draftId = body?.draftId as string | undefined
  if (!draftId || !body?.fields || typeof body.fields !== 'object') return NextResponse.json({ error: 'Missing draftId or fields' }, { status: 400 })
  const row = await getDraftRow(couponDrafts, draftId)
  if (!row || row.coupon_id !== id) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  try {
    await withDraftWrite(
      actorOf(admin),
      'coupon',
      draftId,
      db => saveDraftContent(couponDrafts, db, draftId, body.fields, typeof body.title === 'string' ? body.title.slice(0, 120) : undefined),
      { epoch: epochFrom(req) }
    )
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ success: true })
}

// DELETE ?draft=<id> — discard (holder, an unclaimed draft, or an owner role)
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const { admin, res } = await guard(req)
  if (!admin) return res
  const draftId = req.nextUrl.searchParams.get('draft')
  if (!draftId) return NextResponse.json({ error: 'Missing draft' }, { status: 400 })
  const row = await getDraftRow(couponDrafts, draftId)
  if (!row || row.coupon_id !== id) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  const actor = actorOf(admin)
  const denied = await discardGuard(actor, 'coupon', draftId)
  if (denied) return denied
  await discardDraftRow(couponDrafts, draftId)
  await closeAfter(actor, 'coupon', draftId, 'discarded')
  return NextResponse.json({ success: true })
}
