import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { CHANGE_LOG_KINDS, getChangeLog } from '@/lib/admin/change-log'

export const dynamic = 'force-dynamic'

// GET ?kind=order&id=<id>[&fields=status,payment_status][&before=<cursor>][&limit=30]
// Anyone who can read the record can read its change log; IP addresses need audit:read.
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req, { passive: true })
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? ''
  const id = url.searchParams.get('id') ?? ''
  const def = CHANGE_LOG_KINDS[kind]
  if (!def || !/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: 'Unknown record' }, { status: 400 })
  if (!hasScope(admin.role, admin.scopes, def.scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const page = await getChangeLog(kind, id, {
    fields: url.searchParams.get('fields')?.split(',').filter(Boolean),
    before: url.searchParams.get('before'),
    limit: parseInt(url.searchParams.get('limit') || '30', 10) || 30,
    withIp: hasScope(admin.role, admin.scopes, 'audit:read'),
  })
  return NextResponse.json(page)
}
