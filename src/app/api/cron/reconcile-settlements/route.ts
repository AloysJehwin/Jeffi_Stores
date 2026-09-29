import { NextRequest, NextResponse } from 'next/server'
import { reconcileCapturedTransactions } from '@/lib/razorpay-route'

export const dynamic = 'force-dynamic'

/**
 * Safety net for the transfer.processed race: settle captured prepaid rows whose Route transfer
 * has already processed at Razorpay but whose status never advanced (webhook fired before the row
 * was inserted). Reads live transfer status and flips captured -> settled + writes the prepaid
 * settlement ledger. Idempotent.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await reconcileCapturedTransactions({ olderThanMinutes: 2, limit: 200 })
  return NextResponse.json(result)
}
