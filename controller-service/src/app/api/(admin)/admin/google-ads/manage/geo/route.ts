import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { resolveStateNames, suggestGeo } from '@/lib/google-ads/geo'
import { adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET ?q=Kochi: states, cities and regions to target. POST { names }: state names (our shipping
// zones) resolved to geo targets.
export async function GET(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const q = request.nextUrl.searchParams.get('q') ?? ''
  try {
    return NextResponse.json({ options: await suggestGeo(await googleAdsClientFor(), q) })
  } catch (e) {
    return adsErrorResponse(e)
  }
}

const Body = z.object({ names: z.array(z.string().trim().min(1).max(80)).min(1).max(50) })

export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: 'Send the state names to resolve' }, { status: 400 })
  try {
    return NextResponse.json(await resolveStateNames(await googleAdsClientFor(), parsed.data.names))
  } catch (e) {
    return adsErrorResponse(e)
  }
}
