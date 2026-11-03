import { NextRequest, NextResponse } from 'next/server'
import { PO_FIELDS, PURCHASE_ORDERS_ENTITY, canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getPurchaseOrderOverview } from '@/lib/overviews/purchase-orders'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  // The list's filters; the order date is the period itself.
  const q = normalizeQuery(PURCHASE_ORDERS_ENTITY, sp)
  const scope = filterScope(PURCHASE_ORDERS_ENTITY, q, { omit: ['ordered'] })
  try {
    return NextResponse.json(
      await getPurchaseOrderOverview(
        parsePeriod(sp.get('from'), sp.get('to')),
        scope,
        canonicalQuery(q, PO_FIELDS, { omit: ['from', 'to'] })
      )
    )
  } catch (err) {
    console.error('[purchase-orders overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
