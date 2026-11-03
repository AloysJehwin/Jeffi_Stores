import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { ExperimentActionSchema } from '@/lib/google-ads/experiment-spec'
import { experimentAction } from '@/lib/google-ads/experiments'
import { actorOf, adsErrorResponse, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// End, promote or graduate an experiment.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'), 'Running Google Ads experiments')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: 'Invalid experiment id' }, { status: 400 })
  const parsed = ExperimentActionSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  try {
    const { action, dailyBudget, preview } = parsed.data
    return NextResponse.json(await experimentAction(id, action, await googleAdsClientFor(), actorOf(admin), { dailyBudget, preview }))
  } catch (e) {
    return adsErrorResponse(e)
  }
}
