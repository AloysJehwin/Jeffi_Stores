import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadScanStrip } from '@/lib/overviews/scan'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'quick_scan:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await loadScanStrip(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[scan/overview]', err)
    return NextResponse.json({ error: 'Failed to load scan overview' }, { status: 500 })
  }
}
