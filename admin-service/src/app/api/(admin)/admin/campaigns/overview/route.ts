import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadCampaignsOverview } from '@/lib/overviews/campaigns-report'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Same gate as the campaigns list API; middleware adds campaigns:read for /api/admin/campaigns.
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))

  try {
    return NextResponse.json(await loadCampaignsOverview(period))
  } catch (err) {
    console.error('[campaigns/overview]', err)
    return NextResponse.json({ error: 'Failed to load campaigns overview' }, { status: 500 })
  }
}
