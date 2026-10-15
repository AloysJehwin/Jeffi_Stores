import { NextRequest, NextResponse } from 'next/server'
import { reconcileOrphanedTenants } from '@/lib/tenant-registry'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Drift sweep, relocated off the deleted cron worker. Flips any tenant left status='active'
// with no live rds_endpoint → 'suspended' so the resolver never routes it to (or falls back
// to the platform DB from) dead infra. Does not need 60-second resolution — instrumentation.ts
// self-invokes this hourly. Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const reconciled = await reconcileOrphanedTenants().catch(() => [] as string[])
  const { alertStuckJobs } = await import('@/lib/provisioning/alerts')
  const alerted = await alertStuckJobs().catch(() => 0)
  return NextResponse.json({ success: true, reconciled, alerted })
}
