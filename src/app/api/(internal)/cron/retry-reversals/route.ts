import { NextRequest, NextResponse } from 'next/server'
import { retryPendingReversals } from '@/lib/payments/route-settlement'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * Retry Route reversals still short of their proportional target.
 *
 * Razorpay hard-fails a reversal when the linked account has no floating balance, which is
 * common right after the tenant's payout settles. The refund path never blocks the buyer on
 * that — it records the row with reversed_amount below the owed share — and this job re-attempts
 * once balance is available. Row selection and the top-up are owned by route-settlement; a
 * fully-recovered row stops matching. Idempotent.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { retried, recoveredPaise, stillOwedPaise } = await retryPendingReversals(50)
  return NextResponse.json({ retried, recovered: recoveredPaise / 100, stillOwed: stillOwedPaise / 100 })
}
