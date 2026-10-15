import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant } from '@/lib/tenant-registry'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getTenantWallet, rechargeWallet } from '@/lib/payments/wallet'

export const dynamic = 'force-dynamic'

// Platform-admin view of a tenant's shipping wallet, plus manual credits (goodwill, Delhivery
// reversals). Platform host only (middleware 404s /api/admin/ecom on tenant hosts).
const CreditSchema = z.object({
  amountInr: z.number().positive().max(1_000_000),
  note: z.string().trim().min(1).max(300),
})

async function gate(request: NextRequest, tenantId: string) {
  const admin = await authenticateAdmin(request)
  if (!admin) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isPlatformAdmin(admin.role)) return { res: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
  const tenant = await getTenant(tenantId)
  if (!tenant) return { res: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }
  return { admin, tenant }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  const g = await gate(request, tenantId)
  if ('res' in g) return g.res
  return NextResponse.json(await getTenantWallet(tenantId, 200))
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  const g = await gate(request, tenantId)
  if ('res' in g) return g.res

  const parsed = parseBody(CreditSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { amountInr, note } = parsed.data

  const result = await rechargeWallet({ tenantId, amountInr, note: `Platform credit — ${note}` })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  await logAdminAudit({
    adminId: g.admin.adminId,
    action: 'update',
    entityType: 'tenant',
    entityId: tenantId,
    summary: `Wallet credited ₹${amountInr} for tenant ${g.tenant.slug}`,
    metadata: { tenantId, amountInr, note, source: 'platform-admin' },
    request,
  }).catch(() => {})

  return NextResponse.json({ success: true, balance: result.balance })
}
