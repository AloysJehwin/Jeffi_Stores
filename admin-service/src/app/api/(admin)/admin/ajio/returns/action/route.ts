import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { returnsActionPost } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** Received / QC passed (restocks once) / QC failed for a AJIO return. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'ajio_orders:write'), 'ajio_orders:write', 'AJIO orders')
  if (admin instanceof NextResponse) return admin
  return returnsActionPost(request, 'ajio', admin)
}
