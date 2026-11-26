import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Daily series behind the quotations sent insights pop-over on the quotations overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'quotations:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'quotations',
      alias: 'q',
      dateColumn: 'quote_date',
      dateKind: 'date',
      where: 'q.status = \'final\'',
      series: [
        { key: 'awaiting', label: 'Awaiting reply', where: 'q.converted_order_id IS NULL' },
        { key: 'converted', label: 'Converted to order', where: 'q.converted_order_id IS NOT NULL' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
