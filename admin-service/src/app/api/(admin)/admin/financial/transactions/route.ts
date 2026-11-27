import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isDate, MAX_SPAN_DAYS, spanDays } from '@/lib/overview/period'
import { getTransactionsOverview } from '@/lib/finance/transactions'

export const dynamic = 'force-dynamic'

// Finance → Transactions overview (see lib/finance/transactions). Returns the FinanceOverviewContract<Totals> shape.
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
    return NextResponse.json(await getTransactionsOverview(from, to))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
