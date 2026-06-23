import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getLastSyncStatus } from '@/lib/merchant/sync'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const status = await getLastSyncStatus()
  return NextResponse.json({ status: status ?? null })
}
