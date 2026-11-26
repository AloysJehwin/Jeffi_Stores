import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

/** Review form responses per day by status, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'review_forms:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries({
      table: 'review_form_submissions',
      alias: 'rs',
      dateColumn: 'submitted_at',
      joins: 'LEFT JOIN review_forms f ON f.id = rs.form_id',
      series: [
        { key: 'pending', label: 'Pending', where: "COALESCE(rs.status, 'pending') = 'pending'" },
        { key: 'approved', label: 'Approved', where: "rs.status = 'approved'" },
        { key: 'rejected', label: 'Rejected', where: "rs.status = 'rejected'" },
      ],
      top: { label: 'f.title' },
      weeks: q.weeks,
      filter: q.filter,
    }),
    })
  } catch (err) {
    console.error('[review-forms insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
