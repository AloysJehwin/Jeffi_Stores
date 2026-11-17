import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runShowcaseRenewals } from '@controller/lib/showcase/billing'

export const dynamic = 'force-dynamic'

// Daily: Showcase hosting. Reminds three days before a renewal, charges the months due from each workspace's wallet,
// retries a short wallet daily, pauses a site a week after its paid month ended (or when it ends with auto-renew off).
export async function POST(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const run = await runShowcaseRenewals()
  if (run.failed.length) console.warn('[showcase-renew] not renewed', run.failed)
  return NextResponse.json(run)
}
