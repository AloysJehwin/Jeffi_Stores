import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS: Record<string, string> = {
  all: '',
  razorpay: 's.billing_provider = \'razorpay\'',
  phonepe: 's.billing_provider = \'phonepe\'',
}

/** Daily series behind the subscriptions started insights pop-over on the subscriptions overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'subscriptions:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, Object.keys(FILTERS))
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'subscriptions',
      alias: 's',
      dateColumn: 'created_at',
      where: ['s.source <> \'legacy\' AND s.status <> \'created\'', FILTERS[q.filter as string]].filter(Boolean).join(' AND '),
      series: [
        { key: 'active', label: 'Active', where: 's.status = \'active\' AND s.cancelled_at IS NULL' },
        { key: 'cancelled', label: 'Cancelled', where: 's.cancelled_at IS NOT NULL' },
        { key: 'attention', label: 'Needs attention', where: 's.cancelled_at IS NULL AND s.status IN (\'pending\', \'halted\', \'paused\')' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
