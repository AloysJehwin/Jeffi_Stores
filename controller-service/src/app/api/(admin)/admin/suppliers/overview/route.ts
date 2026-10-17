import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { getSupplierOverview } from '@/lib/overviews/suppliers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await getSupplierOverview(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[suppliers overview]', err)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
