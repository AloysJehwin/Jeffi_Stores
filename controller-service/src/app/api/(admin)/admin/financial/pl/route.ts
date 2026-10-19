import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getPLReport, type PLMonth, type PLTotals } from '@/lib/payments/financial'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'

export const dynamic = 'force-dynamic'

type SourceRow = { key: string; label: string; revenue: number }

// Keep PLTotals field names so the client can delta current vs previous without an adapter.
const DEFAULT_TOTALS: PLTotals = {
  revenue: 0, refunds: 0, net_revenue: 0, cogs: 0, gross_profit: 0, gross_margin_pct: 0,
  operating_expenses: 0, operating_profit: 0, tax_collected: 0, order_count: 0,
  revenue_online: 0, revenue_business: 0, revenue_cash_sale: 0, revenue_offline: 0,
}

function toSeries(monthly: PLMonth[]) {
  return monthly.map(m => ({
    label: `${m.month.slice(0, 7)}-01`,
    revenue: m.revenue,
    cogs: m.cogs,
    gross_profit: m.gross_profit,
    net_revenue: m.net_revenue,
  }))
}

function toSources(t: PLTotals): SourceRow[] {
  return [
    { key: 'online', label: 'Website', revenue: t.revenue_online },
    { key: 'business', label: 'B2B', revenue: t.revenue_business },
    { key: 'cash_sale', label: 'Cash sale', revenue: t.revenue_cash_sale },
    { key: 'offline', label: 'Offline / Store', revenue: t.revenue_offline },
  ].filter(s => s.revenue > 0)
}

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const range = parsePeriod(searchParams.get('from'), searchParams.get('to'), undefined, 'fy')
    const prev = previousPeriod(range)
    const bucket = bucketFor(range)

    const [cur, prv] = await Promise.all([
      getPLReport(range.from, range.to),
      getPLReport(prev.from, prev.to),
    ])

    const current = cur?.totals ?? DEFAULT_TOTALS
    const previous = prv?.totals ?? DEFAULT_TOTALS
    const monthly = cur?.monthly ?? []

    return NextResponse.json({
      range,
      previous_range: prev,
      bucket,
      current,
      previous,
      series: toSeries(monthly),
      by_dim: monthly,
      by_dim2: toSources(current),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
