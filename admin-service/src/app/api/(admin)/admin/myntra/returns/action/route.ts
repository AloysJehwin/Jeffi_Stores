import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { returnsActionPost } from '@/lib/marketplace/orders-route'

export const dynamic = 'force-dynamic'

/** Received / QC passed (restocks once) / QC failed for a Myntra return. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra_orders:write'), 'myntra_orders:write', 'Myntra orders')
  if (admin instanceof NextResponse) return admin
  return returnsActionPost(request, 'myntra', admin)
}
