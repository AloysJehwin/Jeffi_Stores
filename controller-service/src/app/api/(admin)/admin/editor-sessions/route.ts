import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { openSession, RESOURCE_TYPES, type ResourceType } from '@/lib/admin/editor-sessions'
import { zUuid } from '@/lib/shared/validate'
import { announceDraftLock, draftLockResponse } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

// Cancel rolls the resource back to the session snapshot, so opening one needs the resource's write scope.
const WRITE_SCOPE: Record<ResourceType, string> = {
  mailer: 'mailer:write',
  review_form: 'review_forms:write',
  product: 'products:write',
  category: 'categories:write',
  brand: 'brands:write',
  coupon: 'coupons:write',
  campaign: 'campaigns:write',
  supplier: 'inventory:write',
  offer: 'coupons:write',
  site_controls: 'settings:write',
  po_new: 'inventory:write',
  po_receive: 'inventory:write',
  homepage: 'settings:write',
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const resourceType = raw.resource_type as string
  const resourceId = raw.resource_id as string
  if (!RESOURCE_TYPES.includes(resourceType as ResourceType))
    return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 })
  if (!zUuid.safeParse(resourceId).success)
    return NextResponse.json({ error: 'Invalid resource_id' }, { status: 400 })
  if (!hasScope(admin.role, admin.scopes, WRITE_SCOPE[resourceType as ResourceType]))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Opening a session takes the draft lock (423 when another admin holds it).
  const actor = { adminId: admin.adminId, role: admin.role, scopes: admin.scopes }
  let session: Awaited<ReturnType<typeof openSession>>
  try {
    session = await openSession(admin.adminId, resourceType as ResourceType, resourceId, actor)
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.lock) await announceDraftLock(actor, resourceType as never, resourceId, session.lock)

  return NextResponse.json({
    session_id: session.id,
    resumed: session.resumed,
    started_at: session.startedAt,
    change_count: session.changeCount,
  })
}
