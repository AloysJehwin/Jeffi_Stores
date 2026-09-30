import { NextRequest, NextResponse } from 'next/server'
import { runPoolAutoscale } from '@/lib/pool-autoscale'
import { verifyCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

// Tenant-pool auto-scale-UP: resize the single pool EC2 by active-tenant count
// (t4g.small≤10, medium≤25, large≤50, xlarge≤100). Up-only; dry-run unless
// POOL_AUTOSCALE_ENABLED=true. Schedule hourly. Auth: Bearer ${CRON_SECRET}.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runPoolAutoscale()
    return NextResponse.json({ success: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'autoscale failed' }, { status: 500 })
  }
}
