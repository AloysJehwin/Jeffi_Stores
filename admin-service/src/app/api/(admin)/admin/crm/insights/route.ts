import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCrmInsights } from '@/lib/shared/crm-insights'
import { isCrmRange, isCrmSegment } from '@/lib/shared/crm-insights-sql'
import type { AnalyticsRange } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'crm:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rangeParam = req.nextUrl.searchParams.get('range')
  const segmentParam = req.nextUrl.searchParams.get('segment')
  const range: AnalyticsRange = isCrmRange(rangeParam) ? rangeParam : '30d'
  const segment = isCrmSegment(segmentParam) ? segmentParam : 'all'

  const insights = await getCrmInsights({ range, segment })
  return NextResponse.json(insights)
}
