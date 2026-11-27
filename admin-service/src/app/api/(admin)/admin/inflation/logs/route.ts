import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { inflationLogs } from '@/lib/catalog/inflation-log'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Optional ?limit&offset (+ ?sort&dir) pages the log (with a total); without them, the latest 100 as before.
  return NextResponse.json(await inflationLogs(request.nextUrl.searchParams))
}
