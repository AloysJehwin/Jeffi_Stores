import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getTenant, controlPlanePool } from '@/lib/tenant-registry'
import { triggerProvisioning } from '@/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

// Operator-triggered deprovision-with-backup for a tenant. DESTRUCTIVE — requires an
// explicit { confirm: true } body. Takes the store offline, snapshots its DB to S3, then
// deletes the RDS instance + tenant bucket. Routes through the shared trigger (one code path).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'ecom_customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'Deprovision requires { confirm: true }' }, { status: 400 })
  }

  // Resolve the owner so the backup is keyed for restore-on-re-onboard.
  const ownerRow = await controlPlanePool()
    .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [id])
    .catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id ?? null

  const result = await triggerProvisioning({
    action: 'deprovision',
    tenantId: id,
    slug: tenant.slug,
    plan: tenant.plan,
    ownerId,
    reason: 'operator',
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
