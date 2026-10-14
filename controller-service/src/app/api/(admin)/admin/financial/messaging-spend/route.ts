import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getMessagingSpend } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

// Messaging spend (control-plane wallet_ledger) for the Finance → Messaging tab. Reads the x-tenant-id
// header like wallet/topup, since ALS is empty in route handlers and the data is control-plane.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const tenantId = request.headers.get('x-tenant-id')
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })
  return NextResponse.json(await getMessagingSpend(tenantId))
}
