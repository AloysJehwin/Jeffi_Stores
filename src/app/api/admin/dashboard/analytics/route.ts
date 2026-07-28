import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getDashboardAnalytics, type AnalyticsRange } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const RANGES: AnalyticsRange[] = ['today', '7d', '30d', '90d', 'month', 'year']

/**
 * Range-aware commerce analytics for the admin dashboard. Backs the interactive
 * range selector — the page server-renders an initial range, this route serves
 * subsequent range switches.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'dashboard:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const raw = request.nextUrl.searchParams.get('range') || '30d'
    const range: AnalyticsRange = RANGES.includes(raw as AnalyticsRange) ? (raw as AnalyticsRange) : '30d'

    const analytics = await getDashboardAnalytics(range)
    return NextResponse.json({ analytics })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load analytics' }, { status: 500 })
  }
}
