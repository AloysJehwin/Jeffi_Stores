import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { ordersActionPost } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** Accept, reject (with a reason), pack or mark ready to dispatch, one order or many. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio_orders:write'), 'ajio_orders:write', 'AJIO orders')
  if (admin instanceof NextResponse) return admin
  return ordersActionPost(request, 'ajio', admin)
}
