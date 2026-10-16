import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson, withPlan } from '@/lib/channels/route'
import { MadsActionSchema, runMadsAction } from '@/lib/meta-ads/console'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'meta_ads_campaigns:write'), 'meta_ads_campaigns:write', 'Managing Meta Ads')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const parsed = MadsActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  try {
    const out = await runMadsAction(parsed.data, actorOf(admin), body?.preview === true)
    return NextResponse.json(out, { status: out.ok || out.preview ? 200 : 400 })
  } catch (e) {
    return channelError(e, 'Connect Meta Ads first.')
  }
}
