import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getTenant, getProvisioningJob } from '@/lib/tenant-registry'
import { triggerProvisioning, resolveRestoreKey } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

// Operator-triggered provisioning for a tenant — a manual override alongside the four
// owner-portal flows. Routes through the SAME shared trigger so there is one code path:
// enqueue (idempotent) + seed payload, then advance (stub inline / AWS self-advancing loop).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'ecom_customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const restoreFromKey = await resolveRestoreKey(id, tenant.slug)
  const result = await triggerProvisioning({
    action: 'provision',
    tenantId: id,
    slug: tenant.slug,
    plan: tenant.plan,
    ownerId: null,
    restoreFromKey,
    reason: 'operator',
  })

  const job = await getProvisioningJob(id)
  const t = await getTenant(id)
  return NextResponse.json({
    success: result.ok,
    jobStatus: job?.status,
    tenantStatus: t?.status,
    rdsEndpoint: (t as any)?.rds_endpoint ?? null,
    error: job?.last_error ?? result.error ?? null,
  })
}
