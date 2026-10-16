import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { amazonConfigured } from '@/lib/amazon/client'
import { AMAZON_RULES } from '@/lib/amazon/alerts'
import { importAmazonOrders, ordersEnabled } from '@/lib/amazon/orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => (!(await amazonConfigured()) ? 'not_connected' : !(await ordersEnabled()) ? 'disabled' : null),
    async () => {
      const r = await importAmazonOrders()
      return { status: r.status, counts: r.counts, errors: r.errors.length, alerts: await runChannelAlerts(AMAZON_RULES) }
    }
  )
}
