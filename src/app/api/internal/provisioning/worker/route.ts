import { NextRequest, NextResponse } from 'next/server'
import { activeProvisioningJobs, getProvisioningJob, controlPlanePool } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { provisionTenantOwnerAdmin } from '@/lib/tenant-admin-provision'

export const dynamic = 'force-dynamic'

// Recurring provisioning worker. Advances every active job by ONE step per tick. Driven by the
// in-app scheduler (instrumentation.ts) on a short interval — this replaces the unreliable
// per-request setTimeout self-fetch: in the Next server model a post-response timer may never
// fire, so a job that parks on the ~10-min RDS wait needs an out-of-band driver to keep moving
// it. Idempotent per step. Auth: Bearer ${CRON_SECRET}.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = getProvisioningProvider()
  const jobs = await activeProvisioningJobs()
  const results: Array<{ tenantId: string; step: string; status: string }> = []

  for (const job of jobs) {
    const fresh = await getProvisioningJob(job.tenant_id)
    if (!fresh || fresh.status === 'done' || fresh.status === 'failed') continue
    const status = await advanceProvisioningJob(fresh, provider).catch((e: any) => `error: ${e?.message}`)
    results.push({ tenantId: job.tenant_id, step: fresh.step, status })
    // On transition to done, create the owner super_admin + cert in the now-real tenant DB.
    if (status === 'done') await fireOwnerAdmin(job.tenant_id)
  }

  return NextResponse.json({ success: true, advanced: results.length, results })
}

async function fireOwnerAdmin(tenantId: string): Promise<void> {
  const row = await controlPlanePool().query(
    `SELECT o.email, o.name, t.slug
     FROM owner_tenants ot
     JOIN owners o ON o.id = ot.owner_id
     JOIN tenants t ON t.id = ot.tenant_id
     WHERE ot.tenant_id = $1 LIMIT 1`, [tenantId],
  ).catch(() => null)
  const r = row?.rows[0]
  if (!r) return
  await provisionTenantOwnerAdmin({ tenantId, tenantSlug: r.slug, ownerEmail: r.email, ownerName: r.name })
    .catch(() => {})
}
