import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getTenantWallet } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

// Wallet balance + ledger for the pickup-page card. Lives under the topup prefix so it is reachable
// on delhivery:read (basic/growth), unlike the financial:* recharge GET.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ALS tenant context is empty in API route handlers — read the header middleware sets.
  const tenantId = request.headers.get('x-tenant-id')
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const wallet = await getTenantWallet(tenantId)
  return NextResponse.json(wallet)
}
