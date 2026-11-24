import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { runBillingSweep } from '@controller/lib/billing/sweep'

export const dynamic = 'force-dynamic'

// Daily (CRON_JOBS billing_sweep): trial reminders and trial-end pauses, grace-end pauses, lines reaching their end,
// migration notices and deadlines, abandoned checkouts, and a catch-up for missed subscription webhooks. A step that
// fails answers 500 so the run shows as failed on the cron status page; the other steps still run.
export async function POST(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const run = await runBillingSweep()
  if (run.failed.length) console.warn('[billing-sweep] steps failed', run.failed)
  return NextResponse.json(run, { status: run.failed.length ? 500 : 200 })
}
