import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { ExperimentSpecSchema } from '@/lib/google-ads/experiment-spec'
import { createExperiment, loadExperiments, refreshExperiments } from '@/lib/google-ads/experiments'
import { actorOf, adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// Re-read experiments and their results from Google (reporting), then return the tab data.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  try {
    await refreshExperiments(await googleAdsClientFor())
    return NextResponse.json(await loadExperiments())
  } catch (e) {
    return adsErrorResponse(e)
  }
}

// Create a campaign experiment; preview: true only validates it with Google.
export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'), 'Running Google Ads experiments')
  if (admin instanceof NextResponse) return admin
  const body = (await readJson(request)) as Record<string, unknown> | null
  const parsed = ExperimentSpecSchema.safeParse(body?.spec)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue ? `${issue.path.join('.') || 'spec'}: ${issue.message}` : 'Invalid experiment' }, { status: 400 })
  }
  try {
    const result = await createExperiment(parsed.data, await googleAdsClientFor(), actorOf(admin), { preview: body?.preview === true })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return adsErrorResponse(e)
  }
}
