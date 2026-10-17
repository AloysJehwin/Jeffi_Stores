import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadReturnsOverview } from '@/lib/overviews/returns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'returns:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json(await loadReturnsOverview('refund', period, { full: true }))
  } catch (err) {
    console.error('[returns/overview]', err)
    return NextResponse.json({ error: 'Failed to load returns overview' }, { status: 500 })
  }
}
