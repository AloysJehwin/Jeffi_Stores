import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { resolveRequestTenant } from '@/lib/shared/db'
import { runAutopayRenewals } from '@/lib/subscriptions/autopay'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// PhonePe Autopay renewals: pre-debit notification, the debit on the due date, the cycle's order.
export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => null,
    async () => {
      const t = await resolveRequestTenant()
      return runAutopayRenewals({ store: t ? { tenantId: t.tenantId, slug: t.slug } : null })
    }
  )
}
