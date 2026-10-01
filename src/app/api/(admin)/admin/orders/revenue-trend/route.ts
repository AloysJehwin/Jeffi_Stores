import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getRevenueTrendBySource, type RevenuePeriod } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const VALID: RevenuePeriod[] = ['3m', '6m', '12m', 'ytd', 'all']

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const raw = new URL(request.url).searchParams.get('period') || '12m'
  const period = (VALID.includes(raw as RevenuePeriod) ? raw : '12m') as RevenuePeriod
  const trend = await getRevenueTrendBySource(period)
  return NextResponse.json({ period, trend })
}
