import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getRfqOverview } from '@/lib/overviews/business-rfqs'
import { RFQ_ENTITY } from '@/lib/filters/entities/business-rfqs'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_rfqs:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    // The list's filters, except its date (the period owns from / to).
    const scope = filterScope(RFQ_ENTITY, normalizeQuery(RFQ_ENTITY, sp), { omit: ['created'] })
    return NextResponse.json(await getRfqOverview(parsePeriod(sp.get('from'), sp.get('to')), undefined, scope))
  } catch (err) {
    console.error('[business-rfqs overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
