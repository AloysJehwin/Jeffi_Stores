import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, periodArgs } from '@/lib/overviews/marketing'
import {
  KPI_SQL,
  STATES_SQL,
  STATE_SQL,
  customerAttention,
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

  try {
    const [kpis, states, state] = await Promise.all([
      queryMany<Record<string, unknown>>(KPI_SQL, args),
      queryMany<Record<string, unknown>>(STATES_SQL, args),
      queryOne<Record<string, unknown>>(STATE_SQL),
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
      attention: customerAttention(st, totals.current, totals.previous),
    })
  } catch (err) {
    console.error('[customers/overview]', err)
    return NextResponse.json({ error: 'Failed to load customers overview' }, { status: 500 })
  }
}
