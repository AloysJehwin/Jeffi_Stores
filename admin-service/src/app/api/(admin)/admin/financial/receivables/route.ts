import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays } from '@/lib/overview/period'
import { getReceivablesOverview } from './summary'

export const dynamic = 'force-dynamic'

// Finance → Receivables overview. Returns a FinanceOverviewContract<Totals>.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json(
      { error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` },
      { status: 400 }
    )
  try {
    return NextResponse.json(await getReceivablesOverview(parsePeriod(from, to)))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
