import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'
import { parseInsightsQuery } from '@/lib/insights/series'

export const dynamic = 'force-dynamic'

const FILTERS = ['loyalty', 'referrals']
/** Loyalty points activity and referral sign-ups per day, behind the Overview's insights pop-over. */
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'campaigns:read')
  if (admin instanceof NextResponse) return admin
  const q = parseInsightsQuery(request.nextUrl.searchParams, FILTERS)
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 })
  try {
    return NextResponse.json({
      series: await getInsightsSeries(q.filter === 'referrals'
        ? {
            table: 'referral_signups',
            alias: 'rs',
            dateColumn: 'signed_up_at',
            series: [
              { key: 'joined', label: 'Joined', where: 'rs.rewarded_at IS NULL' },
              { key: 'rewarded', label: 'Rewarded', where: 'rs.rewarded_at IS NOT NULL' },
            ],
            top: { label: 'rs.status' },
            weeks: q.weeks,
            filter: q.filter,
          }
        : {
            table: 'loyalty_ledger',
            alias: 'll',
            dateColumn: 'created_at',
            series: [
              { key: 'earned', label: 'Earned', where: "ll.delta > 0 AND ll.reason <> 'redeem_refund'" },
              { key: 'redeemed', label: 'Redeemed', where: "ll.reason IN ('redeem', 'redeem_refund')" },
              { key: 'reversed', label: 'Reversed', where: "ll.reason IN ('order_reversal', 'referral_reversal')" },
            ],
            top: { label: 'll.reason' },
            weeks: q.weeks,
            filter: q.filter,
          }),
    })
  } catch (err) {
    console.error('[customer-programs insights]', err)
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 })
  }
}
