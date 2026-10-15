import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { loadWizardBootstrap } from '@/lib/google-ads/manage-data'
import { ActionSchema, runAction } from '@/lib/google-ads/actions'
import { actorOf, adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: what the campaign wizard needs from the store's own data. POST: one edit on an existing
// campaign, ad group, ad, keyword or recommendation ({ action, ..., preview? }).
export async function GET(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await loadWizardBootstrap())
  } catch (e) {
    return adsErrorResponse(e)
  }
}

export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const body = (await readJson(request)) as Record<string, unknown> | null
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  try {
    const ads = await googleAdsClientFor()
    return NextResponse.json(await runAction(parsed.data, ads, actorOf(admin), body?.preview === true))
  } catch (e) {
    return adsErrorResponse(e)
  }
}
