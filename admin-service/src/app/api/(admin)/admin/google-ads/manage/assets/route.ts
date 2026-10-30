import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { assetSuggestions } from '@/lib/google-ads/assets'
import { adsErrorResponse, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Sitelinks, callouts, promotions, price lists and snippets built from the store's data, for the
// admin to edit and approve (added with the assets.add action or in the wizard).
export async function GET(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await assetSuggestions())
  } catch (e) {
    return adsErrorResponse(e)
  }
}
