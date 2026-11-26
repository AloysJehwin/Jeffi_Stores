import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** RFQs received per day by stage, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_rfqs:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'business_rfqs',
      alias: 'r',
      dateColumn: 'created_at',
      series: [
        { key: 'pending', label: 'Awaiting review', where: "r.status = 'pending'" },
        { key: 'progress', label: 'In progress', where: "r.status IN ('reviewed', 'negotiating', 'offer_accepted')" },
        { key: 'converted', label: 'Converted', where: "r.status = 'converted'" },
        { key: 'rejected', label: 'Rejected', where: "r.status = 'rejected'" },
      ],
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[business/rfqs insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
