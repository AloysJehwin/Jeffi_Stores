import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, periodArgs } from '@/lib/overviews/marketing'
import {
  FORMS_SQL,
  KPI_SQL,
  STATE_SQL,
  reviewFormAttention,
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

  try {
    const [kpis, formRows, state] = await Promise.all([
      queryMany<Record<string, unknown>>(KPI_SQL, args),
      queryMany<Record<string, unknown>>(FORMS_SQL, args),
      queryOne<Record<string, unknown>>(STATE_SQL),
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
