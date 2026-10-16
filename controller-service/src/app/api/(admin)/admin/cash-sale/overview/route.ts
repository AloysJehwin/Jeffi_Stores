import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadCashSaleOverview } from '@/lib/overviews/cash-sale'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json(await loadCashSaleOverview(period))
  } catch (err) {
    console.error('[cash-sale/overview]', err)
    return NextResponse.json({ error: 'Failed to load cash sale overview' }, { status: 500 })
  }
}
