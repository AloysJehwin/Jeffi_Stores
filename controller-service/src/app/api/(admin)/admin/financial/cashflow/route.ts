import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays } from '@/lib/overview/period'
import { getCashflowOverview } from './summary'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const sp = request.nextUrl.searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
      return NextResponse.json(
        { error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` },
        { status: 400 }
      )

    const period = parsePeriod(from, to, undefined, 'fy')
    const result = await getCashflowOverview(period)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
