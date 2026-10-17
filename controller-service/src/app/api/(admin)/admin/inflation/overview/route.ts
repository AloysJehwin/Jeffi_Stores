import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { num, numOrNull, periodArgs } from '@/lib/overviews/catalog'
import {
  INFLATION_PERIOD_SQL,
  INFLATION_RECENT_SQL,
  INFLATION_STALE_SQL,
  inflationAttention,
  runStats,
} from '@/lib/overviews/inflation'

export const dynamic = 'force-dynamic'

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inflation:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)

  try {
    const [periods, recent, stale] = await Promise.all([
      queryMany<Record<string, unknown>>(INFLATION_PERIOD_SQL, periodArgs(period, previous)),
      queryMany<Record<string, unknown>>(INFLATION_RECENT_SQL),
      queryMany<Record<string, unknown>>(INFLATION_STALE_SQL),
    ])
    const runs = recent.map(r => ({
      id: String(r.id),
      categoryId: (r.category_id as string) ?? null,
      categoryName: String(r.category_name ?? ''),
      percentage: numOrNull(r.percentage),
      fields: (r.applied_fields as string[]) ?? [],
      products: num(r.product_count),
      by: (r.applied_by as string) ?? null,
      at: iso(r.applied_at),
      isRollback: !!r.is_rollback,
      rolledBackAt: iso(r.rolled_back_at),
    }))
    const lastRun = runs.find(r => !r.isRollback && !r.rolledBackAt) ?? null
    const staleCats = stale.map(r => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      products: num(r.products),
      lastRun: iso(r.last_run),
    }))
    const current = runStats(periods.find(r => r.cur === true))
    return NextResponse.json({
      period,
      previous,
      current,
      previousStats: runStats(periods.find(r => r.cur === false)),
      lastRun,
      recent: runs,
      staleCategories: staleCats.slice(0, 10),
      staleCount: staleCats.length,
      attention: inflationAttention(lastRun?.at ?? null, staleCats, current.rollbacks),
    })
  } catch (err) {
    console.error('[inflation/overview]', err)
    return NextResponse.json({ error: 'Failed to load bulk price overview' }, { status: 500 })
  }
}
