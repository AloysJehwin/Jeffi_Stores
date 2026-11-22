import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { connectionDelete, connectionGet, connectionPost } from '@/lib/marketplace/connection-route'

export const dynamic = 'force-dynamic'

/** Connection status; credential values and the push token are never returned here. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:read'), 'flipkart:read', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  return connectionGet('flipkart')
}

/** Save + test, or ?action=test | rotate-token | test-order. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:write'), 'flipkart:write', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  return connectionPost(request, 'flipkart', admin)
}

export async function DELETE(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'flipkart:write'), 'flipkart:write', 'Flipkart')
  if (admin instanceof NextResponse) return admin
  return connectionDelete('flipkart', admin)
}
