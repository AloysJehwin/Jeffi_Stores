import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getRevenueTrendBySource, type RevenuePeriod } from '@/lib/queries'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'

export const dynamic = 'force-dynamic'

const VALID: RevenuePeriod[] = ['3m', '6m', '12m', 'ytd', 'all']

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const sp = new URL(request.url).searchParams
  const raw = sp.get('period') || '12m'
  const period = (VALID.includes(raw as RevenuePeriod) ? raw : '12m') as RevenuePeriod
  // The list's filters, minus its order date: the chart has its own window.
  const q = normalizeQuery(ORDERS_ENTITY, sp)
  const scope = filterScope(ORDERS_ENTITY, q, { omit: ['created'], ctx: await ORDERS_ENTITY.context?.(q) })
  const trend = await getRevenueTrendBySource(period, scope)
  return NextResponse.json({ period, trend })
}
