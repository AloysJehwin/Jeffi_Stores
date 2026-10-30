import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { amazonConfigured } from '@/lib/amazon/client'
import { AMAZON_RULES } from '@/lib/amazon/alerts'
import { refreshOffers } from '@/lib/amazon/console'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await amazonConfigured()) ? null : 'not_connected'),
    async () => {
      const r = await refreshOffers({ autoReprice: true })
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(AMAZON_RULES) }
    }
  )
}
