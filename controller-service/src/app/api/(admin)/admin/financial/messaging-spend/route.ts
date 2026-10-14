import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { FLAGSHIP_TENANT_ID, getMessagingSpend } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

// Messaging spend for the Finance → Messaging tab. Reads the x-tenant-id header like wallet/topup, since
// ALS is empty in route handlers; middleware sets it on every tenant host, so none means the flagship.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return NextResponse.json(await getMessagingSpend(request.headers.get('x-tenant-id') ?? FLAGSHIP_TENANT_ID))
}
