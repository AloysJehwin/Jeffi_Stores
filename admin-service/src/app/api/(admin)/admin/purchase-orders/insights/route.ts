import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Daily series behind the purchase orders raised insights pop-over on the purchase-orders overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'purchase_orders',
      alias: 'po',
      dateColumn: 'order_date',
      dateKind: 'date',
      where: 'po.status <> \'draft\'',
      series: [
        { key: 'awaiting', label: 'Awaiting delivery', where: 'po.status IN (\'sent\', \'partial\')' },
        { key: 'received', label: 'Received', where: 'po.status = \'received\'' },
        { key: 'cancelled', label: 'Cancelled', where: 'po.status = \'cancelled\'' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
