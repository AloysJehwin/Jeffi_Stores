import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { linkMerchantCenter, merchantLinkStatus } from '@/lib/google-ads/merchant-link'
import { actorOf, adsErrorResponse, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await merchantLinkStatus(await googleAdsClientFor()))
  } catch (e) {
    return adsErrorResponse(e)
  }
}

export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  try {
    const ads = await googleAdsClientFor()
    const outcome = await linkMerchantCenter(ads, actorOf(admin))
    return NextResponse.json({ ok: true, ...outcome, status: outcome.status, link: await merchantLinkStatus(ads) })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
