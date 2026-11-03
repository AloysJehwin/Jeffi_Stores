import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { AiClientError } from '@/lib/shared/ai-client'
import { COPY_KINDS, writeAdCopy } from '@/lib/google-ads/ad-copy'
import { MANAGE_SCOPE, readJson, withCampaignPlan } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const short = z.string().trim().max(200)
const Body = z.object({
  kind: z.enum(COPY_KINDS),
  context: z
    .object({
      productNames: z.array(short).max(20).optional(),
      category: short.nullable().optional(),
      brand: short.nullable().optional(),
      keywords: z.array(short).max(30).optional(),
      finalUrl: z.string().max(500).nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      links: z.array(z.object({ name: short, url: z.string().max(500) })).max(20).optional(),
      facts: z.array(short).max(10).optional(),
    })
    .default({}),
})

// "Write with AI" for ad copy, gated like every admin AI tool (AI on the plan + campaign management).
export async function POST(request: NextRequest) {
  const admin = await withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write'))
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, MANAGE_SCOPE)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  try {
    return NextResponse.json(await writeAdCopy(parsed.data.kind, parsed.data.context))
  } catch (e) {
    const msg = e instanceof AiClientError ? 'The AI service is not reachable right now. Try again shortly.' : String((e as any)?.message ?? e)
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 })
  }
}
