import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { num, periodArgs } from '@/lib/overviews/catalog'
import {
  ENRICHMENT_PERIOD_SQL,
  ENRICHMENT_STATE_SQL,
  approvalRate,
  enrichmentAttention,
  enrichmentState,
} from '@/lib/overviews/catalog-enrichment'

export const dynamic = 'force-dynamic'

function stats(r: Record<string, unknown> | undefined) {
  const approved = num(r?.approved)
  const rejected = num(r?.rejected)
  return {
    proposed: num(r?.proposed),
    products: num(r?.products),
    approved,
    rejected,
    failed: num(r?.failed),
    tokens: num(r?.tokens),
    approvalRate: approvalRate(approved, rejected),
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'catalog_enrichment:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)

  try {
    const [periods, state] = await Promise.all([
      queryMany<Record<string, unknown>>(ENRICHMENT_PERIOD_SQL, periodArgs(period, previous)),
      queryOne<Record<string, unknown>>(ENRICHMENT_STATE_SQL),
    ])
    const current = stats(periods.find(r => r.cur === true))
    const s = enrichmentState(state)
    return NextResponse.json({
      period,
      previous,
      current,
      previousStats: stats(periods.find(r => r.cur === false)),
      state: s,
      attention: enrichmentAttention(s, current.failed),
    })
  } catch (err) {
    console.error('[catalog-enrichment/overview]', err)
    return NextResponse.json({ error: 'Failed to load catalogue enrichment overview' }, { status: 500 })
  }
}
