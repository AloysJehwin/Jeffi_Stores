import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadReturnsOverview } from '@/lib/overviews/returns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'replacements:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json(await loadReturnsOverview('replacement', period, { full: false }))
  } catch (err) {
    console.error('[replacements/overview]', err)
    return NextResponse.json({ error: 'Failed to load replacements overview' }, { status: 500 })
  }
}
