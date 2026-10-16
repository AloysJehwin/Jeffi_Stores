import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getAdminSubscriptionStats } from '@/lib/queries/subscriptions'
import { loadSubscriptionOverview } from '@/lib/overviews/subscriptions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'subscriptions:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    // Headline counts and MRR come from the list's own stats so the two always agree.
    return NextResponse.json(await loadSubscriptionOverview(period, await getAdminSubscriptionStats()))
  } catch (err) {
    console.error('[subscriptions/overview]', err)
    return NextResponse.json({ error: 'Failed to load subscriptions overview' }, { status: 500 })
  }
}
