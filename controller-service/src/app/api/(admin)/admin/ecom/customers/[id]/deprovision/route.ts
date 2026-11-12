import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getTenant, controlPlanePool, KEEP_ALL, parseArchiveKeep, archiveRetentionDays } from '@/lib/tenant-registry'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'

export const dynamic = 'force-dynamic'

// Operator-triggered deprovision for a tenant. DESTRUCTIVE — requires an explicit { confirm: true }
// body. Takes the store offline, copies what `keep` names (database, media files, configuration)
// for the owner to restore within the retention period, then deletes the database and the bucket
// and revokes the store's API keys and certificates. `keep` is { database, media, config }, all
// three booleans; left out, everything is kept (the admin page always sends it: the administrator
// decides each item). Routes through the shared trigger (one code path).
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
  const keep = body.keep === undefined ? KEEP_ALL : parseArchiveKeep(body.keep)
  if (!keep) {
    return NextResponse.json({ error: 'keep must be { database, media, config }, each true or false' }, { status: 400 })
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
    keep,
    requestedBy: (admin as { email?: string; id?: string }).email ?? (admin as { id?: string }).id ?? 'operator',
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, kept: keep, archiveId: result.archiveId ?? null, retentionDays: archiveRetentionDays() })
}
