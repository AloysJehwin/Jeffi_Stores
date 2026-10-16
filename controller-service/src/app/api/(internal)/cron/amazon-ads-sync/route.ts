import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { adsEnvReady, readAmazonAdsConfig } from '@/lib/amazon-ads/client'
import { syncAmazonAds } from '@/lib/amazon-ads/sync'
import { AMAZON_ADS_RULES } from '@/lib/amazon-ads/alerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => (!adsEnvReady() ? 'not_configured' : !(await readAmazonAdsConfig())?.profile_id ? 'not_connected' : null),
    async () => {
      const r = await syncAmazonAds()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(AMAZON_ADS_RULES) }
    }
  )
}
