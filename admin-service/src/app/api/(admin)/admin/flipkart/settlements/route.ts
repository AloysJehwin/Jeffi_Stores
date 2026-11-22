import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { settlementsGet } from '@/lib/marketplace/catalog-routes'

export const dynamic = 'force-dynamic'

/** Imported Flipkart settlements in ?from..to, the receivable and unsettled orders. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:read'), 'flipkart:read', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  return settlementsGet(request, 'flipkart')
}
