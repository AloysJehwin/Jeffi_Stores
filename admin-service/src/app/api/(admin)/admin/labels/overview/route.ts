import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { parsePeriod } from '@/lib/overview/period'
import { loadLabelsStrip } from '@/lib/overviews/labels'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'labels:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  try {
    return NextResponse.json(await loadLabelsStrip(parsePeriod(sp.get('from'), sp.get('to'))))
  } catch (err) {
    console.error('[labels/overview]', err)
    return NextResponse.json({ error: 'Failed to load labels overview' }, { status: 500 })
  }
}
