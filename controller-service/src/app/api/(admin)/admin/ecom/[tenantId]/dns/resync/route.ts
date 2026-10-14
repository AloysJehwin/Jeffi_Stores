import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant } from '@/lib/tenant-registry'
import { triggerProvisioning } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

// Re-applies the tenant's DNS host set to its CURRENT plan tier (DNS-only, never touches
// RDS/S3). Used when a host was added to a tier after the tenant was provisioned — e.g.
// forms-{slug} moving to Growth — so live tenants pick it up without re-provisioning.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.status !== 'active') {
    return NextResponse.json(
      { error: `Tenant is ${tenant.status}; DNS re-sync applies to active tenants only.` },
      { status: 409 }
    )
  }

  const result = await triggerProvisioning({
    action: 'reprovision',
    tenantId,
    slug: tenant.slug,
    plan: tenant.plan ?? null,
    ownerId: null,
    reason: 'operator',
  })
  if (!result.ok) return NextResponse.json({ error: result.error || 'DNS re-sync failed' }, { status: 500 })

  return NextResponse.json({ success: true, added: result.added ?? [], removed: result.removed ?? [] })
}
