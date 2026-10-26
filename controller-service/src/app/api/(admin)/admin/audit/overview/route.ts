import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getAuditOverview } from '@/lib/overviews/audit'
import { AUDIT_ENTITY } from '@/lib/filters/entities/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'audit:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    // The audit list's filters, except its date (the period owns from / to).
    const scope = filterScope(AUDIT_ENTITY, normalizeQuery(AUDIT_ENTITY, sp), { omit: ['created'] })
    return NextResponse.json(await getAuditOverview(parsePeriod(sp.get('from'), sp.get('to')), scope))
  } catch (err) {
    console.error('[audit overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
