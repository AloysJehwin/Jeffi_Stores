import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import {
  getTenant, enqueueProvisioning, getProvisioningJob,
} from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'

export const dynamic = 'force-dynamic'

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
  await enqueueProvisioning(id)

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
