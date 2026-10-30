import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isDate, MAX_SPAN_DAYS, spanDays } from '@/lib/overview/period'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { settlementOverview } from '@/lib/payments/rzp-settlement-report'

export const dynamic = 'force-dynamic'

// GET — the account's settlements to the bank in a period. Route stores are paid out instead (404).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const account = await razorpayAccountFor()
  if (account.kind === 'route') return NextResponse.json({ error: 'This store is paid out through Route.' }, { status: 404 })

  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if (!(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json({ error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` }, { status: 400 })
  return NextResponse.json(await settlementOverview(account.kind, from, to))
}
