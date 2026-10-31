import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { sweepRazorpay } from '@/lib/payments/rzp-sweep'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    // Throws (skipped as not_connected) when the store has no Razorpay keys at all.
    async () => (await getRazorpayInstanceFor((await razorpayAccountFor()).tenantId ?? undefined), null),
    async () => {
      const r = await sweepRazorpay()
      return { status: r.status, counts: r.counts, errors: r.errors.length }
    }
  )
}
