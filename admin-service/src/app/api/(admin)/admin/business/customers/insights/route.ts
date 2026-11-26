import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Business applications per day by outcome, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'business_profiles',
      alias: 'bp',
      dateColumn: 'created_at',
      series: [
        { key: 'approved', label: 'Approved', where: "bp.approval_status = 'approved'" },
        { key: 'pending', label: 'Pending', where: "bp.approval_status = 'pending'" },
        { key: 'rejected', label: 'Rejected', where: "bp.approval_status = 'rejected'" },
      ],
      top: { label: 'bp.industry' },
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[business/customers insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
