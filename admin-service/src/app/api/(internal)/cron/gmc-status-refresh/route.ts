import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { merchantConfigured } from '@/lib/merchant/client'
import { refreshGmcStatusSnapshot } from '@/lib/merchant/gmc-status'
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
      const r = await refreshGmcStatusSnapshot()
      if ('locked' in r) return { skipped: 'running' }
      return { status: 'success', total: r.total, alerts: await runChannelAlerts(GMC_RULES) }
    }
  )
}
