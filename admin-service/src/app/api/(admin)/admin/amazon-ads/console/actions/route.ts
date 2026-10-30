import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, channelError, readJson, withPlan } from '@/lib/channels/route'
import { AadsActionSchema, runAadsAction } from '@/lib/amazon-ads/console'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_ads:write'), 'amazon_ads:write', 'Managing Amazon Ads')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const parsed = AadsActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  try {
    const out = await runAadsAction(parsed.data, actorOf(admin), body?.preview === true)
    return NextResponse.json(out, { status: out.ok || out.preview ? 200 : 400 })
  } catch (e) {
    return channelError(e, 'Connect Amazon Ads first.')
  }
}
