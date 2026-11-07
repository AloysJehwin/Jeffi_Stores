import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { settlementsGet } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'

/** Imported Myntra settlements in ?from..to, the receivable and unsettled orders. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return settlementsGet(request, 'myntra')
}
