import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Shelf movements per day, added and removed, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'shelf_stock_transactions',
      alias: 't',
      dateColumn: 'created_at',
      series: [
        { key: 'added', label: 'Added', where: 't.quantity_change > 0' },
        { key: 'removed', label: 'Removed', where: 't.quantity_change < 0' },
      ],
      top: { label: "COALESCE(t.reason, 'adjustment')" },
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[shelving insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
