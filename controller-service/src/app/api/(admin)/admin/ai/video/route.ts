export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { AI_VIDEO_ASPECTS, AI_VIDEO_FEATURES } from '@/lib/ai/media-features'
import { AI_FEATURE_SCOPES } from '@/lib/ai/scope-map'
import { generateVideo } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'

const Body = z.object({
  feature: z.enum(AI_VIDEO_FEATURES),
  prompt: z.string().trim().min(3).max(2000),
  imageUrl: z.string().url().optional(),
  durationSec: z.union([z.literal(4), z.literal(6), z.literal(8)]).optional(),
  aspect: z.enum(AI_VIDEO_ASPECTS).optional(),
  ref: z.string().max(80).optional(),
})

// POST /api/admin/ai/video: pre-authorise and start a video job; the client polls video/[jobId].
export async function POST(request: NextRequest) {
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || 'Invalid body' }, { status: 400 })
  const { feature } = body.data
  // One literal :write scope per feature (the write-scope audit reads these).
  const admin =
    feature === 'offer_video' ? await requireAdminScope(request, 'coupons:write')
    : feature === 'homepage_video' ? await requireAdminScope(request, 'settings:write')
    : await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, AI_FEATURE_SCOPES[feature])
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  try {
    const r = await generateVideo({ ...body.data, actor: admin.email ?? null })
    return NextResponse.json(r)
  } catch (err) {
    return aiMediaErrorResponse(err, 'Video start failed')
  }
}
