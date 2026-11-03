import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { adsAppReady, adsEnvReady, readAmazonAdsConfig } from '@/lib/amazon-ads/client'
import { syncAmazonAds } from '@/lib/amazon-ads/sync'
import { AMAZON_ADS_RULES } from '@/lib/amazon-ads/alerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => {
      const cfg = await readAmazonAdsConfig()
      if (!cfg?.profile_id) return adsEnvReady() ? 'not_connected' : 'not_configured'
      return adsAppReady(cfg) ? null : 'not_configured'
    },
    async () => {
      const r = await syncAmazonAds()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(AMAZON_ADS_RULES) }
    }
  )
}
