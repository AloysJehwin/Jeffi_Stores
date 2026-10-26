import { NextRequest, NextResponse } from 'next/server'
import { QUOTATIONS_ENTITY, QUOTATION_FIELDS, canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadQuotationOverview } from '@/lib/overviews/quotations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'quotations:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  // The list's filters; the quote date is the period itself.
  const q = normalizeQuery(QUOTATIONS_ENTITY, sp)
  const scope = filterScope(QUOTATIONS_ENTITY, q, { omit: ['quoted'] })
  try {
    return NextResponse.json(
      await loadQuotationOverview(period, scope, canonicalQuery(q, QUOTATION_FIELDS, { omit: ['from', 'to'] }))
    )
  } catch (err) {
    console.error('[quotations/overview]', err)
    return NextResponse.json({ error: 'Failed to load quotations overview' }, { status: 500 })
  }
}
