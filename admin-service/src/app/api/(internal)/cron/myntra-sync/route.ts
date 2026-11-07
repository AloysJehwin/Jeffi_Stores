import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { adsRuleSet } from '@/lib/marketplace-ads/alerts'
import { marketplaceSyncSkip, runMarketplaceSync } from '@/lib/marketplace/sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// Order events, listing tasks, stock and alerts; the ads alerts run too (they need no connection).
export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => null,
    async () => {
      const adsAlerts = await runChannelAlerts(adsRuleSet('myntra_ads'))
      const skip = await marketplaceSyncSkip('myntra')
      return skip ? { skipped: skip, adsAlerts } : { ...(await runMarketplaceSync('myntra')), adsAlerts }
    }
  )
}
