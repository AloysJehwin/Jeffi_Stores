import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS: Record<string, string> = {
  all: '',
  online: 'o.source = \'online\'',
  business: 'o.source = \'business\'',
  offline: 'o.source = \'offline\'',
}

/** Daily series behind the revenue and refunds insights pop-over on the financial overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, Object.keys(FILTERS))
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'orders',
      alias: 'o',
      dateColumn: 'created_at',
      where: ['o.status <> \'draft\'', FILTERS[q.filter as string]].filter(Boolean).join(' AND '),
      series: [
        { key: 'revenue', label: 'Revenue', where: 'o.payment_status = \'paid\' AND o.status NOT IN (\'cancelled\', \'returned\', \'draft\', \'cancel_rejected\')', value: 'SUM(o.total_amount)' },
        { key: 'refunds', label: 'Refunds', where: 'o.status IN (\'cancelled\', \'returned\') AND o.payment_status = \'paid\'', value: 'SUM(o.total_amount)' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
