import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { parsePeriod, previousPeriod } from '@/lib/overview/period'
import { num, periodArgs } from '@/lib/overviews/catalog'
import {
  UNCATEGORISED_SQL,
  classifyGroups,
  groupAttention,
  groupSql,
  toGroupRow,
} from '@/lib/overviews/categories'
import { CATEGORIES_ENTITY } from '@/lib/filters/entities/categories'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'categories:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)

  // The list's filters (not its created date: the period owns from / to); none leaves the SQL unchanged.
  const q = normalizeQuery(CATEGORIES_ENTITY, sp)
  const s5 = filterScope(CATEGORIES_ENTITY, q, { omit: ['created'] }).inIds('g.id', 5)

  try {
    const [raw, unassigned] = await Promise.all([
      queryMany<Record<string, unknown>>(groupSql('category', s5.sql), [...periodArgs(period, previous), ...s5.params]),
      queryOne<Record<string, unknown>>(UNCATEGORISED_SQL),
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
      attention: groupAttention('category', c, rows, missing),
    })
  } catch (err) {
    console.error('[categories/overview]', err)
    return NextResponse.json({ error: 'Failed to load categories overview' }, { status: 500 })
  }
}
