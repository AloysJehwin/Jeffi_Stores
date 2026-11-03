import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { ENTITY_READ_SCOPE, listRecordReplies } from '@/lib/replies/admin'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?entityType=orders&entityId=… — the customer's replies about one record.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const entityType = sp.get('entityType') ?? ''
  const entityId = sp.get('entityId') ?? ''
  const scope = ENTITY_READ_SCOPE[entityType]
  if (!scope || !UUID.test(entityId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (!hasScope(admin.role, admin.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return NextResponse.json(await listRecordReplies(entityType, entityId))
}
