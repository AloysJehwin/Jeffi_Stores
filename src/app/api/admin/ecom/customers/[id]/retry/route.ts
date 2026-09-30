import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getTenant, getProvisioningJob, resumeProvisioningJob } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'

export const dynamic = 'force-dynamic'

/**
 * Resume a failed provisioning job from the step it died on, rather than starting over.
 * enqueueProvisioning opens a NEW job for a failed tenant — fresh created_resources, first
 * step — which re-creates infrastructure that already exists.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'ecom_customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const resumed = await resumeProvisioningJob(id)
  if (!resumed.ok) return NextResponse.json({ error: resumed.detail, reason: resumed.reason }, { status: 409 })

  // Kick it immediately so the operator sees movement instead of waiting for the next sweep.
  const queued = await getProvisioningJob(id)
  if (queued) await advanceProvisioningJob(queued, getProvisioningProvider()).catch(() => {})

  const job = await getProvisioningJob(id)
  return NextResponse.json({
    ok: true,
    resumedFrom: resumed.resumedFrom,
    jobStatus: job?.status ?? null,
    step: job?.step ?? null,
    error: job?.last_error ?? null,
  })
}
