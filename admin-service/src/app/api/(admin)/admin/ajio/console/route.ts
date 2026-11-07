import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { consoleGet } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** Overview KPIs and queue counts; ?view=orders&bucket= or ?view=returns for the lists. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio:read'), 'ajio:read', 'AJIO')
  if (admin instanceof NextResponse) return admin
  return consoleGet(request, 'ajio')
}
