import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, withPlan } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { syncAmazonAds } from '@/lib/amazon-ads/sync'
import { AMAZON_ADS_RULES } from '@/lib/amazon-ads/alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:write'), 'amazon_ads:write', 'Amazon Ads')
  if (admin instanceof NextResponse) return admin
  try {
    const r = await syncAmazonAds()
    return NextResponse.json({ ...r, alerts: await runChannelAlerts(AMAZON_ADS_RULES) })
  } catch (e) {
    return channelError(e, 'Connect Amazon Ads first.')
  }
}
