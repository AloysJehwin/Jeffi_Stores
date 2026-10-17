import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { readMetaAdsConfig } from '@/lib/meta-ads/client'
import { META_ADS_RULES } from '@/lib/meta-ads/alerts'
import { syncMetaAds } from '@/lib/meta-ads/sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => {
      const cfg = await readMetaAdsConfig()
      return cfg?.ad_account_id ? null : 'not_connected'
    },
    async () => {
      const r = await syncMetaAds()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(META_ADS_RULES) }
    }
  )
}
