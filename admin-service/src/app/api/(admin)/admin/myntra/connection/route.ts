import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { withPlan } from '@/lib/channels/route'
import { connectionDelete, connectionGet, connectionPost } from '@/lib/marketplace/connection-route'

export const dynamic = 'force-dynamic'

/** Connection status; credential values and the push token are never returned here. */
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:read'), 'myntra:read', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return connectionGet('myntra')
}

/** Save + test, or ?action=test | rotate-token | test-order. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return connectionPost(request, 'myntra', admin)
}

export async function DELETE(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'myntra:write'), 'myntra:write', 'Myntra')
  if (admin instanceof NextResponse) return admin
  return connectionDelete('myntra', admin)
}
