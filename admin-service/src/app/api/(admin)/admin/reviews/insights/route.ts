import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'pending', 'approved', 'verified']
const WHERE: Record<string, string | undefined> = {
  all: undefined,
  pending: 'pr.is_approved IS NOT TRUE',
  approved: 'pr.is_approved IS TRUE',
  verified: 'pr.is_verified_purchase IS TRUE',
}

/** Reviews received per day by rating band, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'reviews:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'product_reviews',
      alias: 'pr',
      dateColumn: 'created_at',
      joins: 'LEFT JOIN products p ON p.id = pr.product_id',
      where: WHERE[q.filter!],
      series: [
        { key: 'positive', label: '4-5 stars', where: 'pr.rating >= 4' },
        { key: 'neutral', label: '3 stars', where: 'pr.rating = 3' },
        { key: 'critical', label: '1-2 stars', where: 'pr.rating <= 2' },
      ],
      top: { label: 'p.name' },
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[reviews insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
