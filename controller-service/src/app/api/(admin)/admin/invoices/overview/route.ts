import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadInvoiceOverview } from '@/lib/overviews/invoices'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'invoices:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  try {
    return NextResponse.json(await loadInvoiceOverview(period))
  } catch (err) {
    console.error('[invoices/overview]', err)
    return NextResponse.json({ error: 'Failed to load invoices overview' }, { status: 500 })
  }
}
