import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, periodArgs } from '@/lib/overviews/marketing'
import { REVIEW_FORMS_ENTITY } from '@/lib/filters/entities/review-forms'
import {
  formsSql,
  kpiSql,
  reviewFormAttention,
  stateSql,
  toFormRow,
  toReviewFormState,
  toReviewFormTotals,
} from '@/lib/overviews/review-forms'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'review_forms:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const args = periodArgs(period, previous)
  // The list's filters (not its created date: the period owns from / to), as form-id conditions.
  const scope = filterScope(REVIEW_FORMS_ENTITY, normalizeQuery(REVIEW_FORMS_ENTITY, sp), { omit: ['created'] })
  const subs = scope.inIds('rs.form_id', args.length + 1)
  const formIds = scope.inIds('f.id', args.length + 1)
  const own = [scope.inIds('id', 1), scope.inIds('form_id', 1)]

  try {
    const [kpis, formRows, state] = await Promise.all([
      queryMany<Record<string, unknown>>(kpiSql(subs.sql), [...args, ...subs.params]),
      queryMany<Record<string, unknown>>(formsSql(formIds.sql), [...args, ...formIds.params]),
      scope.empty
        ? queryOne<Record<string, unknown>>(stateSql())
        : queryOne<Record<string, unknown>>(stateSql(own[0].sql, own[1].sql), own[0].params),
    ])
    const totals = byPeriod(kpis, toReviewFormTotals)
    const forms = formRows.map(toFormRow)
    const st = toReviewFormState(state ?? undefined)
    return NextResponse.json({
      period,
      previous,
      current: totals.current,
      previous_totals: totals.previous,
      forms,
      state: st,
      attention: reviewFormAttention(st, forms),
    })
  } catch (err) {
    console.error('[review-forms/overview]', err)
    return NextResponse.json({ error: 'Failed to load review forms overview' }, { status: 500 })
  }
}
