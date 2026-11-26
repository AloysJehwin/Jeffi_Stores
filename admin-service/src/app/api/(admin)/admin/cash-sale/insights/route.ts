import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Daily series behind the cash sales insights pop-over on the cash-sale overview. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    const series = await getInsightsSeries({
      table: 'cash_sales',
      alias: 'cs',
      dateColumn: 'created_at',
      where: 'cs.status <> \'cancelled\'',
      series: [
        { key: 'cash', label: 'Cash', where: 'cs.payment_mode = \'cash\'' },
        { key: 'upi', label: 'UPI', where: 'cs.payment_mode LIKE \'upi%\'' },
        { key: 'card', label: 'Card & other', where: 'cs.payment_mode <> \'cash\' AND cs.payment_mode NOT LIKE \'upi%\'' },
      ],
      weeks: q.weeks,
      filter: q.filter,
    })
    return NextResponse.json({ series })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load insights' }, { status: 500 })
  }
}
