import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import {
  isValidRange,
  presetRange,
} from '@controller/app/(admin)/admin/financial/_components/overview-period'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'
import { getFinanceOverview } from './summary'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  try {
    const sp = request.nextUrl.searchParams
    const asked = { from: sp.get('from') ?? '', to: sp.get('to') ?? '' }
    if ((asked.from || asked.to) && !isValidRange(asked))
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD, from <= to, at most 400 days' }, { status: 400 })
    const range = asked.from ? asked : presetRange('30d')
    // GST figures follow the GST pages' scope.
    const withGst = hasScope(admin.role, admin.scopes, 'gst:read')
    const tenantId = request.headers.get('x-tenant-id')
    const flagship = !tenantId || tenantId === FLAGSHIP_TENANT_ID
    return NextResponse.json(await getFinanceOverview(range, { withGst, flagship }))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
