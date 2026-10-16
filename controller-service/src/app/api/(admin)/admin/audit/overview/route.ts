import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getAuditOverview } from '@/lib/overviews/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'audit:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await getAuditOverview(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[audit overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
