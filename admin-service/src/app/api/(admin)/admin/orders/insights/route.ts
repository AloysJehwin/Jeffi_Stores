import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS: Record<string, string> = {
  all: '',
  online: 'o.source = \'online\'',
  cod: 'COALESCE(o.payment_mode, \'\') ILIKE \'%cod%\'',
  business: 'o.source = \'business\'',
}

/** Daily series behind the orders placed insights pop-over on the orders overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'orders:read')
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
        { key: 'delivered', label: 'Delivered', where: 'o.status = \'delivered\'' },
        { key: 'progress', label: 'In progress', where: 'o.status NOT IN (\'delivered\', \'cancelled\', \'returned\')' },
        { key: 'cancelled', label: 'Cancelled', where: 'o.status IN (\'cancelled\', \'returned\')' },
      ],
      top: { label: 'COALESCE(NULLIF(o.payment_mode, \'\'), \'other\')' },
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
