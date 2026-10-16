import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import {
  isValidRange,
  presetRange,
} from '@/app/(admin)/admin/financial/_components/overview-period'
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
    return NextResponse.json(await getFinanceOverview(range, { withGst }))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
