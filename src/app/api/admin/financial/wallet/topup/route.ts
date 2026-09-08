import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { getCurrentTenant } from '@/lib/tenant-context'
import { getTenantWallet } from '@/lib/wallet'

export const dynamic = 'force-dynamic'

// Wallet balance + ledger for the pickup-page card. Lives under the topup prefix so it is reachable
// on delhivery:read (basic/growth), unlike the financial:* recharge GET.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = getCurrentTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const wallet = await getTenantWallet(tenant.tenantId)
  return NextResponse.json(wallet)
}
