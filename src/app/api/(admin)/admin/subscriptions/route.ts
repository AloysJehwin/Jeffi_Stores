import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getAdminSubscriptionStats, listAdminSubscriptions } from '@/lib/queries/subscriptions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'subscriptions:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const sp = req.nextUrl.searchParams
  const [list, stats] = await Promise.all([
    listAdminSubscriptions({
      status: sp.get('status') || undefined,
      q: sp.get('q') || undefined,
      page: parseInt(sp.get('page') || '1', 10) || 1,
    }),
    getAdminSubscriptionStats(),
  ])
  return NextResponse.json({ ...list, stats })
}
