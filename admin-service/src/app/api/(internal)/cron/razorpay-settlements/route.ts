import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { syncRazorpaySettlements } from '@/lib/payments/rzp-settlements'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await razorpayAccountFor()).kind === 'route' ? 'route_store' : null),
    async () => {
      const r = await syncRazorpaySettlements()
      return { status: r.status, counts: r.counts, errors: r.errors.length }
    }
  )
}
