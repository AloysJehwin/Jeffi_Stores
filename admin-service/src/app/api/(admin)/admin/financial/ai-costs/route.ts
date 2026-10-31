import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays } from '@/lib/overview/period'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'
import { getAiCosts } from './summary'

export const dynamic = 'force-dynamic'

// Finance → AI costs. No x-tenant-id header (middleware sets it on every tenant host) means the flagship.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json({ error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` }, { status: 400 })
  try {
    const tenantId = request.headers.get('x-tenant-id')
    const flagship = !tenantId || tenantId === FLAGSHIP_TENANT_ID
    return NextResponse.json(await getAiCosts(parsePeriod(from, to), { flagship }))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
