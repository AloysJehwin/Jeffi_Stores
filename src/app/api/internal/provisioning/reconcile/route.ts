import { NextRequest, NextResponse } from 'next/server'
import { reconcileOrphanedTenants } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Drift sweep, relocated off the deleted cron worker. Flips any tenant left status='active'
// with no live rds_endpoint → 'suspended' so the resolver never routes it to (or falls back
// to the platform DB from) dead infra. Does not need 60-second resolution — instrumentation.ts
// self-invokes this hourly. Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const reconciled = await reconcileOrphanedTenants().catch(() => [] as string[])
  return NextResponse.json({ success: true, reconciled })
}
