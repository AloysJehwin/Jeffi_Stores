import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, num, periodArgs, str } from '@/lib/overviews/marketing'
import {
  EXPIRING_SQL,
  KPI_SQL,
  SOURCE_SQL,
  STATE_SQL,
  TOP_SQL,
  UNUSED_SQL,
  couponAttention,
  seriesSql,
  toState,
  toTopCoupon,
  toTotals,
} from '@/lib/overviews/coupons'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'coupons:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = periodArgs(period, previous)

  try {
    const [kpis, series, top, sources, state, expiring, unused] = await Promise.all([
      queryMany<Record<string, unknown>>(KPI_SQL, args),
      queryMany<Record<string, unknown>>(seriesSql(bucket), args),
      queryMany<Record<string, unknown>>(TOP_SQL, args),
      queryMany<Record<string, unknown>>(SOURCE_SQL, args),
      queryOne<Record<string, unknown>>(STATE_SQL),
      queryMany<Record<string, unknown>>(EXPIRING_SQL),
      queryMany<Record<string, unknown>>(UNUSED_SQL),
    ])
    const totals = byPeriod(kpis, toTotals)
    const st = toState(state ?? undefined)
    return NextResponse.json({
      period,
      previous,
      bucket,
      current: totals.current,
      previous_totals: totals.previous,
      series: series.map(r => ({ label: str(r.label), redemptions: num(r.redemptions), discount: num(r.discount) })),
      top: top.map(toTopCoupon),
      sources: sources.map(r => ({
        source: str(r.source),
        redemptions: num(r.redemptions),
        discount: num(r.discount),
      })),
      state: st,
      expiring: expiring.map(r => ({
        id: str(r.id),
        code: str(r.code),
        valid_until: r.valid_until,
        times_used: num(r.times_used),
        usage_limit: r.usage_limit == null ? null : num(r.usage_limit),
      })),
      unused: unused.map(r => ({
        id: str(r.id),
        code: str(r.code),
        created_at: r.created_at,
        valid_until: r.valid_until,
      })),
      attention: couponAttention(st, totals.current),
    })
  } catch (err) {
    console.error('[coupons/overview]', err)
    return NextResponse.json({ error: 'Failed to load coupons overview' }, { status: 500 })
  }
}
