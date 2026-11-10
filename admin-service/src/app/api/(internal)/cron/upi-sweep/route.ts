import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { resolveRequestTenant } from '@/lib/shared/db'
import { sweepUpiIntents } from '@/lib/payments/upi/settle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Settles PhonePe intents whose webhook was lost and whose browser never came back.
export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => null,
    async () => {
      const t = await resolveRequestTenant()
      return sweepUpiIntents({ store: t ? { tenantId: t.tenantId, slug: t.slug } : null })
    }
  )
}
