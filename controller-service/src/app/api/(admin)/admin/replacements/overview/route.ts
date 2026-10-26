import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadReturnsOverview } from '@/lib/overviews/returns'
import { REPLACEMENTS_ENTITY } from '@/lib/filters/entities/returns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'replacements:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    // The list's filters, except its date (the period owns from / to).
    const scope = filterScope(REPLACEMENTS_ENTITY, normalizeQuery(REPLACEMENTS_ENTITY, sp), { omit: ['created'] })
    return NextResponse.json(await loadReturnsOverview('replacement', period, { full: false }, scope))
  } catch (err) {
    console.error('[replacements/overview]', err)
    return NextResponse.json({ error: 'Failed to load replacements overview' }, { status: 500 })
  }
}
