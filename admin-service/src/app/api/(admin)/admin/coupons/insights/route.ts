import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Daily series behind the coupon redemptions insights pop-over on the coupons overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'coupons:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'coupon_usage',
      alias: 'cu',
      dateColumn: 'created_at',
      joins: 'JOIN coupons c ON c.id = cu.coupon_id',
      where: '',
      series: [
        { key: 'public', label: 'Public codes', where: 'NOT c.auto_generated' },
        { key: 'campaign', label: 'Campaign codes', where: 'c.auto_generated' },
      ],
      top: { label: 'c.code' },
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
