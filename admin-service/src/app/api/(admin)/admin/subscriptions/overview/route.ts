import { NextRequest, NextResponse } from 'next/server'
import { canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getAdminSubscriptionStats } from '@/lib/queries/subscriptions'
import { loadSubscriptionOverview } from '@/lib/overviews/subscriptions'
import { SUBSCRIPTIONS_ENTITY } from '@/lib/filters/entities/subscriptions'
import { SUBSCRIPTION_FIELDS } from '@/lib/filters/fields/subscriptions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'subscriptions:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  // The list's filters, not its start date (the period owns from/to).
  const q = normalizeQuery(SUBSCRIPTIONS_ENTITY, sp)
  const scope = filterScope(SUBSCRIPTIONS_ENTITY, q, { omit: ['created'] })
  try {
    // Headline counts and MRR come from the list's own stats so the two always agree.
    if (scope.empty) return NextResponse.json(await loadSubscriptionOverview(period, await getAdminSubscriptionStats()))
    const headline = await getAdminSubscriptionStats(scope.and(1))
    const query = canonicalQuery(q, SUBSCRIPTION_FIELDS, { omit: ['from', 'to'] })
    return NextResponse.json({ ...(await loadSubscriptionOverview(period, headline, scope, query)), filtered: true })
  } catch (err) {
    console.error('[subscriptions/overview]', err)
    return NextResponse.json({ error: 'Failed to load subscriptions overview' }, { status: 500 })
  }
}
