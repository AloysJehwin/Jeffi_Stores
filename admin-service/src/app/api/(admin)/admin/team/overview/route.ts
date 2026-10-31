import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { parsePeriod } from '@/lib/overview/period'
import { getTeamOverview } from '@/lib/overviews/team'

export const dynamic = 'force-dynamic'

// Owner-only, like the team page: no scope expresses it.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformOwner(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await getTeamOverview(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[team overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
