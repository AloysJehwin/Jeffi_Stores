import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getRfqOverview } from '@/lib/overviews/business-rfqs'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_rfqs:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await getRfqOverview(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[business-rfqs overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
