import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadCashSaleOverview } from '@/lib/overviews/cash-sale'
import { CASH_SALE_ENTITY } from '@/lib/filters/entities/cash-sale'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    // The list's filters, except its date (the period owns from / to).
    const scope = filterScope(CASH_SALE_ENTITY, normalizeQuery(CASH_SALE_ENTITY, sp), { omit: ['invoice'] })
    return NextResponse.json(await loadCashSaleOverview(period, scope))
  } catch (err) {
    console.error('[cash-sale/overview]', err)
    return NextResponse.json({ error: 'Failed to load cash sale overview' }, { status: 500 })
  }
}
