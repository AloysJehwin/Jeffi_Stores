import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { listAssetGroups } from '@/lib/google-ads/audiences/attach'
import {
  AudienceRefreshInProgressError,
  acceptCustomerMatchTerms,
  loadAudiences,
  refreshAudiences,
  saveAudienceSetting,
} from '@/lib/google-ads/audiences/refresh'
import { SEGMENTS, SegmentParamsSchema } from '@/lib/google-ads/audiences/segments'
import { actorOf, adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// GET: the store's Customer Match lists. GET ?assetGroups=<campaignId>: a Performance Max
// campaign's asset groups for the signal picker (campaign management). POST: settings, the
// Customer Match terms, or a refresh now.
export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get('assetGroups')
  if (campaignId) {
    const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
    if (admin instanceof NextResponse) return admin
    try {
      return NextResponse.json({ assetGroups: await listAssetGroups(await googleAdsClientFor(), campaignId) })
    } catch (e) {
      return adsErrorResponse(e)
    }
  }
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await loadAudiences())
}

const BodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('settings'), segment: z.enum(SEGMENTS), enabled: z.boolean(), params: SegmentParamsSchema.default({}) }),
  z.object({ op: z.literal('terms'), accept: z.literal(true) }),
  z.object({ op: z.literal('refresh'), segment: z.enum(SEGMENTS).optional() }),
])

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = BodySchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  const b = parsed.data
  try {
    if (b.op === 'settings') await saveAudienceSetting(b.segment, b.enabled, b.params)
    else if (b.op === 'terms') await acceptCustomerMatchTerms()
    else {
      const run = await refreshAudiences({ actor: actorOf(admin), only: b.segment })
      return NextResponse.json({ run, data: await loadAudiences() })
    }
    return NextResponse.json({ data: await loadAudiences() })
  } catch (e) {
    if (e instanceof AudienceRefreshInProgressError) return NextResponse.json({ error: e.message }, { status: 409 })
    return adsErrorResponse(e)
  }
}
