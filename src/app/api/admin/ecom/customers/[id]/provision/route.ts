import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import {
  getTenant, enqueueProvisioning, getProvisioningJob, controlPlanePool, getDraft,
} from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { findLatestBackup } from '@/lib/tenant-backup-store'

export const dynamic = 'force-dynamic'

/**
 * Resolve a restore-from-backup key IF the owner opted into "restore my previous store
 * data" during onboarding AND a backup actually exists (by owner id or the new slug).
 */
async function resolveRestoreKey(tenantId: string, slug: string): Promise<string | undefined> {
  const ownerRow = await controlPlanePool().query(
    `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId],
  ).catch(() => null)
  const ownerId = ownerRow?.rows[0]?.owner_id
  if (!ownerId) return undefined
  const draft = await getDraft(ownerId).catch(() => null)
  if (!draft?.data?.restorePreviousData) return undefined
  const backup = await findLatestBackup({ ownerId, slug }).catch(() => null)
  return backup?.key
}

// Operator-triggered provisioning for a tenant. Enqueues the job and drives it
// to completion. With the STUB provider this finishes synchronously; when the
// real AWS provider lands, this should enqueue only and a cron worker advances
// it (RDS create takes minutes — don't block the request on real infra).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (admin.role !== 'super_admin' && !hasScope(admin.role, admin.scopes, 'ecom_customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const provider = getProvisioningProvider()
  const restoreFromKey = await resolveRestoreKey(id, tenant.slug)
  await enqueueProvisioning(id, restoreFromKey ? { restoreFromKey } : undefined)

  // Drive to completion (stub is instant; real provider = enqueue-only + cron).
  const usingStub = process.env.PROVISIONING_PROVIDER !== 'aws'
  if (usingStub) {
    for (let i = 0; i < 20; i++) {
      const job = await getProvisioningJob(id)
      if (!job || job.status === 'done' || job.status === 'failed') break
      await advanceProvisioningJob(job, provider)
    }
  }

  const job = await getProvisioningJob(id)
  const t = await getTenant(id)
  return NextResponse.json({
    success: job?.status === 'done',
    jobStatus: job?.status,
    tenantStatus: t?.status,
    rdsEndpoint: (t as any)?.rds_endpoint ?? null,
    error: job?.last_error ?? null,
  })
}
