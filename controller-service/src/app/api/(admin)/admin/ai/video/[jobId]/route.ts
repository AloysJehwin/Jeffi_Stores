export const maxDuration = 120
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { AI_VIDEO_FEATURES } from '@/lib/ai/media-features'
import { AI_FEATURE_SCOPES } from '@/lib/ai/scope-map'
import { videoJob } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

const Params = z.object({
  jobId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
  usageId: z.string().uuid().optional(),
  feature: z.enum(AI_VIDEO_FEATURES).default('social_video'),
})

// GET /api/admin/ai/video/[jobId]?usageId=&feature=: poll; the finished video is persisted to S3 once.
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const sp = request.nextUrl.searchParams
  const parsed = Params.safeParse({ jobId: (await params).jobId, usageId: sp.get('usageId') || undefined, feature: sp.get('feature') || undefined })
  const feature = parsed.success ? parsed.data.feature : 'social_video'
  const admin =
    feature === 'offer_video' ? await requireAdminScope(request, 'coupons:write')
    : feature === 'homepage_video' ? await requireAdminScope(request, 'settings:write')
    : await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, AI_FEATURE_SCOPES[feature])
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  try {
    return NextResponse.json(await videoJob(parsed.data.jobId, parsed.data.usageId, await resolveTenantId()))
  } catch (err) {
    return aiMediaErrorResponse(err, 'Video job poll failed')
  }
}
