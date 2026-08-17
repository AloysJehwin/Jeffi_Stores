import { NextRequest, NextResponse } from 'next/server'
import { activeProvisioningJobs, getProvisioningJob } from '@/lib/tenant-registry'
import { advanceProvisioningJob } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'

export const dynamic = 'force-dynamic'

// Cron-driven provisioning worker. The real AWS RDS create takes ~10 min, so
// provision/route.ts only ENQUEUES when PROVISIONING_PROVIDER=aws; this endpoint
// advances each pending/running job by one step per tick. Schedule it every ~1 min.
//
// Auth: Bearer ${CRON_SECRET} (same pattern as the other /api/cron routes).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = getProvisioningProvider()
  const jobs = await activeProvisioningJobs()

  const results: Array<{ tenantId: string; step: string; status: string }> = []
  for (const job of jobs) {
    // Re-fetch the freshest job row (a prior tick in this loop may have advanced it).
    const fresh = await getProvisioningJob(job.tenant_id)
    if (!fresh || fresh.status === 'done' || fresh.status === 'failed') continue
    const status = await advanceProvisioningJob(fresh, provider).catch((e: any) => `error: ${e?.message}`)
    results.push({ tenantId: job.tenant_id, step: fresh.step, status })
  }

  return NextResponse.json({ success: true, advanced: results.length, results })
}
