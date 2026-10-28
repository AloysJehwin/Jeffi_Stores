import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DRAFT_RESOURCES, isDraftResourceType, viewers as listViewers, type DraftResourceType } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { zUuid } from '@/lib/shared/validate'
import {
  acquireDraftLock,
  canReceiveHandover,
  draftLockResponse,
  getDraftLockState,
  handoverCandidates,
  handoverDraftLock,
  releaseDraftLock,
  requestDraftAccess,
  takeoverDraftLock,
} from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ resourceType: string; resourceId: string }> }

// Every lock action needs the draft's write scope (mirrors DRAFT_RESOURCES[type].writeScope).
const WRITE_SCOPE: Record<DraftResourceType, string> = {
  product: 'products:write',
  brand: 'brands:write',
  category: 'categories:write',
  coupon: 'coupons:write',
  review_form: 'review_forms:write',
  supplier: 'inventory:write',
  offer: 'coupons:write',
  campaign: 'campaigns:write',
  homepage: 'settings:write',
  mailer: 'mailer:write',
  invoice: 'invoices:write',
  quotation: 'quotations:write',
  purchase_order: 'inventory:write',
  po_new: 'inventory:write',
  po_receive: 'inventory:write',
  cash_sale: 'invoices:write',
}

const db = { query: (t: string, p?: unknown[]) => query(t, p as any[]) }

async function target(params: Params['params']) {
  const { resourceType, resourceId } = await params
  if (!isDraftResourceType(resourceType)) return null
  if (!zUuid.safeParse(resourceId).success) return null
  return { type: resourceType, id: resourceId }
}

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(req, { passive: true })
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const t = await target(params)
  if (!t) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
  if (!hasScope(admin.role, admin.scopes, DRAFT_RESOURCES[t.type].readScope))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  if (req.nextUrl.searchParams.get('candidates') === '1') {
    if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[t.type])) return NextResponse.json({ candidates: [] })
    return NextResponse.json({ candidates: await handoverCandidates(t.type, admin.adminId) })
  }
  const state = await getDraftLockState(admin, t.type, t.id)
  return NextResponse.json({ ...state, me: admin.adminId, viewers: await listViewers(db, t.type, t.id) })
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('handover'), toAdminId: zUuid }),
  z.object({ action: z.literal('takeover'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('request_access'), message: z.string().max(500).optional() }),
])

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const t = await target(params)
  if (!t) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 })
  if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[t.type]))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  const body = parsed.data
  const actor = { adminId: admin.adminId, role: admin.role, scopes: admin.scopes }

  try {
    switch (body.action) {
      case 'claim': {
        const state = await getDraftLockState(admin, t.type, t.id)
        if (!state.draftExists) return NextResponse.json({ error: 'No draft to claim' }, { status: 404 })
        await acquireDraftLock(actor, t.type, t.id)
        break
      }
      case 'release':
        await releaseDraftLock(actor, t.type, t.id, req)
        break
      case 'handover':
        if (body.toAdminId === admin.adminId) return NextResponse.json({ error: 'You already hold this draft' }, { status: 400 })
        if (!(await canReceiveHandover(t.type, body.toAdminId)))
          return NextResponse.json({ error: 'That admin cannot edit this draft' }, { status: 400 })
        await handoverDraftLock(actor, t.type, t.id, body.toAdminId, req)
        break
      case 'takeover':
        if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Only owners can take over a draft' }, { status: 403 })
        await takeoverDraftLock(actor, t.type, t.id, body.reason, req)
        break
      case 'request_access': {
        const name = [admin.first_name, admin.last_name].filter(Boolean).join(' ') || admin.email
        const r = await requestDraftAccess({ ...actor, displayName: name }, t.type, t.id, body.message, req)
        const state = await getDraftLockState(admin, t.type, t.id)
        if (!r.sent) {
          const error = r.reason === 'rate_limited' ? 'You already asked in the last 5 minutes' : 'Nobody holds this draft — claim it instead'
          return NextResponse.json({ ...state, me: admin.adminId, request: r, error }, { status: r.reason === 'rate_limited' ? 429 : 409 })
        }
        return NextResponse.json({ ...state, me: admin.adminId, request: r })
      }
    }
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    console.error('[draft-locks]', body.action, t.type, t.id, err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
  const state = await getDraftLockState(admin, t.type, t.id)
  return NextResponse.json({ ...state, me: admin.adminId, viewers: await listViewers(db, t.type, t.id) })
}
