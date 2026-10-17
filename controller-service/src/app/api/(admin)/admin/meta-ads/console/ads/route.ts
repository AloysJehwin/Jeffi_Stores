import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson, withPlan } from '@/lib/channels/route'
import { MadsAdSchema } from '@/lib/meta-ads/creative-spec'
import { loadAdSetup, runMadsNewAd, runMadsSwapImage } from '@/lib/meta-ads/creative'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// GET: ad sets and the connected Page for the New ad dialog.
export async function GET(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads:read'), 'meta_ads:read', 'Meta Ads')
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await loadAdSetup())
  } catch (e) {
    return channelError(e, 'Connect Meta Ads first.')
  }
}

// POST: create an image ad or change an ad's image (preview validates with Meta, then apply).
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads_campaigns:write'), 'meta_ads_campaigns:write', 'Managing Meta Ads')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const parsed = MadsAdSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const preview = body?.preview === true
  try {
    const out =
      parsed.data.action === 'create'
        ? await runMadsNewAd(parsed.data, actorOf(admin), preview)
        : await runMadsSwapImage(parsed.data, actorOf(admin), preview)
    return NextResponse.json(out, { status: out.ok || out.preview ? 200 : 400 })
  } catch (e) {
    return channelError(e, 'Connect Meta Ads first.')
  }
}
