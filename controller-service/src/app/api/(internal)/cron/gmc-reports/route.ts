import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { merchantConfigured } from '@/lib/merchant/client'
import { refreshMerchantReports } from '@/lib/merchant/reports'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { GMC_RULES } from '@/lib/merchant/alerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await merchantConfigured()) ? null : 'not_connected'),
    async () => {
      const r = await refreshMerchantReports()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(GMC_RULES) }
    }
  )
}
