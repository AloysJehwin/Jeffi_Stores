import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadQuotationOverview } from '@/lib/overviews/quotations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'quotations:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json(await loadQuotationOverview(period))
  } catch (err) {
    console.error('[quotations/overview]', err)
    return NextResponse.json({ error: 'Failed to load quotations overview' }, { status: 500 })
  }
}
