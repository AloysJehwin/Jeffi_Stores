import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const PAGES = ['all', 'product', 'cart', 'checkout']

// Daily page views against the sessions that made them, optionally for one kind of page (the page_events `page`
// column), behind the Traffic page's insights sheet. Same gate as the traffic API.
export async function GET(request: NextRequest) {
  const auth = await requireAdminScope(request, 'traffic:read')
  if (auth instanceof NextResponse) return auth
  const q = parseInsightsQuery(request.nextUrl.searchParams, PAGES)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const all = q.filter === 'all'
    const series = await getInsightsSeries({
      table: 'page_events',
      alias: 'e',
      dateColumn: 'created_at',
      where: all ? undefined : 'e.page = $1',
      params: all ? [] : [q.filter],
      series: [
        { key: 'visits', label: 'Page views' },
        { key: 'sessions', label: 'Sessions', value: 'COUNT(DISTINCT e.session_id)' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (err) {
    console.error('[traffic insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
