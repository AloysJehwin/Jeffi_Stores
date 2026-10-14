import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { openSession, RESOURCE_TYPES, type ResourceType } from '@/lib/admin/editor-sessions'
import { zUuid } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

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

  const session = await openSession(admin.adminId, resourceType as ResourceType, resourceId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    session_id: session.id,
    resumed: session.resumed,
    started_at: session.startedAt,
    change_count: session.changeCount,
  })
}
