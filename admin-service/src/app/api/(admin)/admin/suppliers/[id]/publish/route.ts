import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { actorOf, draftLockResponse, epochFrom } from '@/lib/admin/draft-locks'
import { draftConflictResponse, getDraftRow } from '@/lib/admin/draft-branches'
import { publishSupplierDraft, supplierDrafts } from '@/lib/admin/supplier-drafts'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

// POST ?draft=<id> { resolutions? } — merge the draft into live; 409 lists overlapping edits.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const draftId = req.nextUrl.searchParams.get('draft') ?? body?.draftId
  if (!draftId) return NextResponse.json({ error: 'Missing draft' }, { status: 400 })
  const row = await getDraftRow(supplierDrafts, draftId)
  if (!row || row.supplier_id !== id) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  try {
    const r = await publishSupplierDraft(draftId, { actor: actorOf(admin), resolutions: body?.resolutions, epoch: epochFrom(req) })
    return NextResponse.json({ success: true, supplierId: id, revision: r.revision })
  } catch (err) {
    const handled = draftLockResponse(err) ?? draftConflictResponse(err)
    if (handled) return handled
    throw err
  }
}
