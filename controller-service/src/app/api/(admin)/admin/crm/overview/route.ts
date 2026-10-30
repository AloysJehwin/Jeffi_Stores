import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { istToday, parsePeriod } from '@controller/app/(admin)/admin/crm/_lib/period'
import { getCrmOverview } from './summary'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await requireAdminScope(req, 'crm:read')
  if (admin instanceof NextResponse) return admin
  const sp = req.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'), istToday())
  try {
    return NextResponse.json(await getCrmOverview(period))
  } catch (err) {
    console.error('crm overview failed', err)
    return NextResponse.json({ error: 'Failed to load CRM overview' }, { status: 500 })
  }
}
