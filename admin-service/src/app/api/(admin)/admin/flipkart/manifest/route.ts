import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { manifestPost } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** Flipkart's manifest for the location's ready-to-dispatch shipments. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart_orders:write'), 'flipkart_orders:write', 'Flipkart orders')
  if (admin instanceof NextResponse) return admin
  return manifestPost(request, 'flipkart', admin)
}
