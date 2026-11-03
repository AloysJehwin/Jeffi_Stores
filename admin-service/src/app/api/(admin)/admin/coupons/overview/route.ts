import { NextRequest, NextResponse } from 'next/server'
import { canonicalQuery, filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, num, periodArgs, str } from '@/lib/overviews/marketing'
import { bindScope } from '@/lib/overview/filter-scope'
import { COUPONS_ENTITY } from '@/lib/filters/entities/coupons'
import { COUPON_FIELDS } from '@/lib/filters/fields/coupons'
import {
  couponAttention,
  expiringSql,
  kpiSql,
  seriesSql,
  sourceSql,
  stateSql,
  topSql,
  unusedSql,
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

  // The list's filters (not its created date: the period owns from/to), after each query's own args.
  const q = normalizeQuery(COUPONS_ENTITY, sp)
  const scope = filterScope(COUPONS_ENTITY, q, { omit: ['created'] })
  const fa = bindScope(scope, args.length + 1)
  const f1 = bindScope(scope, 1)

  try {
    const [kpis, series, top, sources, state, expiring, unused] = await Promise.all([
      queryMany<Record<string, unknown>>(kpiSql(fa), [...args, ...fa.params]),
      queryMany<Record<string, unknown>>(seriesSql(bucket, fa), [...args, ...fa.params]),
      queryMany<Record<string, unknown>>(topSql(fa), [...args, ...fa.params]),
      queryMany<Record<string, unknown>>(sourceSql(fa), [...args, ...fa.params]),
      queryOne<Record<string, unknown>>(stateSql(f1), f1.params),
      queryMany<Record<string, unknown>>(expiringSql(f1), f1.params),
      queryMany<Record<string, unknown>>(unusedSql(f1), f1.params),
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
      filtered: !scope.empty,
      attention: couponAttention(st, totals.current, canonicalQuery(q, COUPON_FIELDS, { omit: ['from', 'to'] })),
    })
  } catch (err) {
    console.error('[coupons/overview]', err)
    return NextResponse.json({ error: 'Failed to load coupons overview' }, { status: 500 })
  }
}
