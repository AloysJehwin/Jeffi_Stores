import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isDate, MAX_SPAN_DAYS, spanDays } from '@/lib/overview/period'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { routeOverview } from '@/lib/payments/rzp-route-report'

export const dynamic = 'force-dynamic'

// GET — a Route store's sales, its share and payouts to its bank in a period. The store comes from the
// request's host, never the query. Stores with settlements of their own use razorpay-settlements (404 here).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const account = await razorpayAccountFor()
  if (account.kind !== 'route' || !account.tenantId)
    return NextResponse.json({ error: 'This store settles on its own Razorpay account.' }, { status: 404 })

  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if (!(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json({ error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` }, { status: 400 })
  return NextResponse.json(await routeOverview(account.tenantId, from, to))
}
