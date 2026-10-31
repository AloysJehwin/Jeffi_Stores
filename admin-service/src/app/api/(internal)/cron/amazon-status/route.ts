import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { amazonConfigured } from '@/lib/amazon/client'
import { AMAZON_RULES } from '@/lib/amazon/alerts'
import { refreshAmazonStatusSnapshot } from '@/lib/amazon/status'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await amazonConfigured()) ? null : 'not_connected'),
    async () => {
      const r = await refreshAmazonStatusSnapshot()
      if ('locked' in r) return { skipped: 'running' }
      return { status: 'success', total: r.total, alerts: await runChannelAlerts(AMAZON_RULES) }
    }
  )
}
