import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getB2bCustomerOverview } from '@/lib/overviews/business-customers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await getB2bCustomerOverview(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[business-customers overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
