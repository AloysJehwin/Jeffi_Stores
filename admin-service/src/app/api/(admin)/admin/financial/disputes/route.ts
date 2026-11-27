import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getDisputes } from '@/lib/finance/disputes'

export const dynamic = 'force-dynamic'

export type { DisputeListRow, DisputesResponse } from '@/lib/finance/disputes'

// GET — this store's chargebacks, open ones first by deadline.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'financial:read')
  if (admin instanceof NextResponse) return admin
  const status = request.nextUrl.searchParams.get('status') || 'all'
  return NextResponse.json(await getDisputes(status))
}
