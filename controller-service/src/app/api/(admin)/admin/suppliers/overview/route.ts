import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getSupplierOverview } from '@/lib/overviews/suppliers'
import { SUPPLIERS_ENTITY } from '@/lib/filters/entities/suppliers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    // The list's filters (not its added-on date: the period owns from / to).
    const scope = filterScope(SUPPLIERS_ENTITY, normalizeQuery(SUPPLIERS_ENTITY, sp), { omit: ['created'] })
    return NextResponse.json(await getSupplierOverview(parsePeriod(sp.get('from'), sp.get('to')), scope))
  } catch (err) {
    console.error('[suppliers overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
