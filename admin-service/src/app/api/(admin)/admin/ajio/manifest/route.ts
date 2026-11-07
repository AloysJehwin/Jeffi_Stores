import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { manifestPost } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** One AJIO manifest (at most 250 packets) for the picked ready-to-dispatch orders. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio_orders:write'), 'ajio_orders:write', 'AJIO orders')
  if (admin instanceof NextResponse) return admin
  return manifestPost(request, 'ajio', admin)
}
