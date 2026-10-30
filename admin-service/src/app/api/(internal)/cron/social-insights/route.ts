import { NextRequest } from 'next/server'
import { channelCron } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { hasSocialAccounts, refreshSocialInsights } from '@/lib/social/jobs'
import { SOCIAL_RULES } from '@/lib/social/alerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  return channelCron(
    req,
    async () => ((await hasSocialAccounts()) ? null : 'not_connected'),
    async () => ({ ...(await refreshSocialInsights()), alerts: await runChannelAlerts(SOCIAL_RULES) })
  )
}
