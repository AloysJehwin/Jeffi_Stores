import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getB2bCustomerOverview } from '@/lib/overviews/business-customers'
import { B2B_ENTITY } from '@/lib/filters/entities/business-customers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    // The account list's filters, except its date (the period owns from / to).
    const scope = filterScope(B2B_ENTITY, normalizeQuery(B2B_ENTITY, sp), { omit: ['created'] })
    return NextResponse.json(await getB2bCustomerOverview(parsePeriod(sp.get('from'), sp.get('to')), undefined, scope))
  } catch (err) {
    console.error('[business-customers overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
