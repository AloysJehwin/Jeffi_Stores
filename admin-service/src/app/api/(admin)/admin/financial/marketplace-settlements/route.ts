import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isDate, MAX_SPAN_DAYS, spanDays } from '@/lib/overview/period'
import { loadMarketplaceSettlementsOverview } from '@/lib/marketplace/settlements'

export const dynamic = 'force-dynamic'

// GET — Myntra and AJIO settlements and receivables, and Amazon's settlements (read-only), in a period.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if (!(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
    return NextResponse.json({ error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` }, { status: 400 })
  try {
    return NextResponse.json(await loadMarketplaceSettlementsOverview({ from, to }))
  } catch (e) {
    console.error('[financial] marketplace settlements failed', e)
    return NextResponse.json({ error: 'Could not load marketplace settlements' }, { status: 500 })
  }
}
