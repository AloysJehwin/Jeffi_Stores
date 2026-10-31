import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { loadCampaignSettings } from '@/lib/google-ads/campaigns'
import { adsErrorResponse, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Live budget and bid settings for the edit dialog (the mirror has no targets or budget id).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
  try {
    const settings = await loadCampaignSettings(await googleAdsClientFor(), id)
    if (!settings) return NextResponse.json({ error: 'Campaign not found in Google Ads' }, { status: 404 })
    return NextResponse.json(settings)
  } catch (e) {
    return adsErrorResponse(e)
  }
}
