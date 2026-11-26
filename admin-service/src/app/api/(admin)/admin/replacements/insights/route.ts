import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Daily series behind the replacement requests insights pop-over on the replacements overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'replacements:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'return_requests',
      alias: 'rr',
      dateColumn: 'created_at',
      where: 'rr.type = \'replacement\'',
      series: [
        { key: 'open', label: 'Open', where: 'rr.status NOT IN (\'completed\', \'rejected\')' },
        { key: 'completed', label: 'Replaced', where: 'rr.status = \'completed\'' },
        { key: 'rejected', label: 'Rejected', where: 'rr.status = \'rejected\'' },
      ],
      top: { label: 'rr.reason' },
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
