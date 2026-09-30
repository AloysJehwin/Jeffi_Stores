import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getTenantWallet, rechargeWallet } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await resolveTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const wallet = await getTenantWallet(tenant.tenantId)
  return NextResponse.json(wallet)
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'financial:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const tenant = await resolveTenant()
  if (!tenant?.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const amountInr = Number(body?.amountInr)
  if (!(amountInr > 0)) return NextResponse.json({ error: 'amountInr must be positive' }, { status: 400 })

  const result = await rechargeWallet({
    tenantId: tenant.tenantId,
    amountInr,
    note: typeof body?.note === 'string' ? body.note : undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ success: true, balance: result.balance })
}
