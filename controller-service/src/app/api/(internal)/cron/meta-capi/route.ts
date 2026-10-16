import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { metaEnvReady, readMetaAdsConfig } from '@/lib/meta-ads/client'
import { META_ADS_RULES } from '@/lib/meta-ads/alerts'
import { sendCapiEvents } from '@/lib/meta-ads/capi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => {
      if (!metaEnvReady()) return 'not_configured'
      const cfg = await readMetaAdsConfig()
      return cfg?.pixel_id ? null : 'no_pixel'
    },
    async () => {
      const r = await sendCapiEvents()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(META_ADS_RULES) }
    }
  )
}
