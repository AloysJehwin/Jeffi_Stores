import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getTenantWallet } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await resolveTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const wallet = await getTenantWallet(tenant.tenantId)
  return NextResponse.json(wallet)
}

// Manual credits are a platform operation (/api/admin/ecom/[tenantId]/wallet). A tenant admin
// crediting its own wallet without paying would ship for free; paid top-ups go through /topup.
export async function POST() {
  return NextResponse.json(
    { error: 'Manual wallet credits are applied by the platform. Use Top up to add balance.' },
    { status: 403 }
  )
}
