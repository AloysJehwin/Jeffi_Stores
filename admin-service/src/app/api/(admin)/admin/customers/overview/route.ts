import { NextRequest, NextResponse } from 'next/server'
import { canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, periodArgs } from '@/lib/overviews/marketing'
import { bindScope } from '@/lib/overview/filter-scope'
import { CUSTOMERS_ENTITY } from '@/lib/filters/entities/customers'
import { CUSTOMER_FIELDS } from '@/lib/filters/fields/customers'
import {
  customerAttention,
  kpiSql,
  stateSql,
  statesSql,
  toCustomerState,
  toCustomerTotals,
  toStateRow,
} from '@/lib/overviews/customers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'customers:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const args = periodArgs(period, previous)

  // The list's filters (not its join date: the period owns from/to), after each query's own args.
  const q = normalizeQuery(CUSTOMERS_ENTITY, sp)
  const scope = filterScope(CUSTOMERS_ENTITY, q, { omit: ['joined'] })
  const fa = bindScope(scope, args.length + 1)
  const f1 = bindScope(scope, 1)

  try {
    const [kpis, states, state] = await Promise.all([
      queryMany<Record<string, unknown>>(kpiSql(fa), [...args, ...fa.params]),
      queryMany<Record<string, unknown>>(statesSql(fa), [...args, ...fa.params]),
      queryOne<Record<string, unknown>>(stateSql(f1), f1.params),
    ])
    const totals = byPeriod(kpis, toCustomerTotals)
    const st = toCustomerState(state ?? undefined)
    return NextResponse.json({
      period,
      previous,
      current: totals.current,
      previous_totals: totals.previous,
      top_states: states.map(toStateRow),
      state: st,
      filtered: !scope.empty,
      attention: customerAttention(
        st,
        totals.current,
        totals.previous,
        canonicalQuery(q, CUSTOMER_FIELDS, { omit: ['from', 'to'] })
      ),
    })
  } catch (err) {
    console.error('[customers/overview]', err)
    return NextResponse.json({ error: 'Failed to load customers overview' }, { status: 500 })
  }
}
