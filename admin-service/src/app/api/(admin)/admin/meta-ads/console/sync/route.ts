import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { channelError, readJson, withPlan } from '@/lib/channels/route'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { syncMetaAds } from '@/lib/meta-ads/sync'
import { sendCapiEvents } from '@/lib/meta-ads/capi'
import { META_ADS_RULES } from '@/lib/meta-ads/alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Run now: the ad account sync, or the Conversions API send. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:write'), 'meta_ads:write', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  const kind = (await readJson(request))?.kind
  try {
    const r = kind === 'capi' ? await sendCapiEvents() : await syncMetaAds()
    return NextResponse.json({ ...r, alerts: await runChannelAlerts(META_ADS_RULES) })
  } catch (e) {
    return channelError(e, 'Connect Meta Ads first.')
  }
}
