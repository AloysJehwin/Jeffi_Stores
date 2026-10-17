import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { num, periodArgs } from '@/lib/overviews/catalog'
import { classifyGroups, groupAttention, toGroupRow } from '@/lib/overviews/categories'
import { BRANDS_SQL, UNBRANDED_SQL } from '@/lib/overviews/brands'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'brands:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)

  try {
    const [raw, unassigned] = await Promise.all([
      queryMany<Record<string, unknown>>(BRANDS_SQL, periodArgs(period, previous)),
      queryOne<Record<string, unknown>>(UNBRANDED_SQL),
    ])
    const rows = raw.map(toGroupRow)
    const c = classifyGroups(rows)
    const missing = num(unassigned?.n)
    return NextResponse.json({
      period,
      previous,
      totals: { ...c.totals, unassigned: missing },
      top: rows.filter(r => r.sales > 0 || r.prevSales > 0 || r.stockValue > 0).slice(0, 10),
      empty: c.empty.map(r => ({ id: r.id, name: r.name, parentName: r.parentName })),
      unused: [...c.unused].sort((a, b) => b.stockValue - a.stockValue).slice(0, 10),
      attention: groupAttention('brand', c, rows, missing),
    })
  } catch (err) {
    console.error('[brands/overview]', err)
    return NextResponse.json({ error: 'Failed to load brands overview' }, { status: 500 })
  }
}
