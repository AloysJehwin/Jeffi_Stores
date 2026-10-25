export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { controlPlanePool } from '@/lib/tenant-registry'
import { credentialOwnerId, isPlatformOwner } from '@/lib/integrations/owner'
import { AI_IMAGE_FEATURES, AI_VIDEO_FEATURES } from '@/lib/ai/media-features'
import { AI_FEATURE_SCOPES } from '@/lib/ai/scope-map'

const Query = z.object({
  feature: z.enum([...AI_IMAGE_FEATURES, ...AI_VIDEO_FEATURES]),
  quality: z.enum(['draft', 'standard', 'premium']).default('standard'),
})

// The provider the gateway prefers for a quality hint (plan: draft -> razer, premium -> google).
const PREFERRED: Record<string, string | null> = { draft: 'razer', standard: null, premium: 'google' }

// GET /api/admin/ai/price?feature=&quality=: per-unit price shown before generating
// (per image, or per second of video). The flagship is never charged, so it quotes 0.
export async function GET(request: NextRequest) {
  const q = Query.safeParse({
    feature: request.nextUrl.searchParams.get('feature') ?? undefined,
    quality: request.nextUrl.searchParams.get('quality') ?? undefined,
  })
  if (!q.success) return NextResponse.json({ error: q.error.issues[0]?.message || 'Invalid query' }, { status: 400 })
  const { feature, quality } = q.data
  const admin =
    feature === 'social_image' || feature === 'social_video' ? await requireAdminScope(request, 'social:write')
    : feature === 'product_image' ? await requireAdminScope(request, 'products:write')
    : feature === 'ads_image' ? await requireAdminScope(request, 'google_ads_campaigns:write')
    : feature === 'email_hero' ? await requireAdminScope(request, 'mailer:write')
    : feature === 'offer_image' || feature === 'offer_video' ? await requireAdminScope(request, 'coupons:write')
    : feature === 'meta_ads_image' ? await requireAdminScope(request, 'meta_ads_campaigns:write')
    // hero_image, homepage_image, homepage_video, generate_image
    : await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, AI_FEATURE_SCOPES[feature])
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  const capability = (AI_VIDEO_FEATURES as readonly string[]).includes(feature) ? 'video' : 'image'
  const unitType = capability === 'video' ? 'video_second' : 'image'
  if (isPlatformOwner(await credentialOwnerId())) return NextResponse.json({ priceInr: 0, unitType, charged: false })

  const rows = await controlPlanePool()
    .query<{ provider: string; model: string; price_inr: string }>(
      `SELECT provider, model, price_inr FROM ai_price_list
        WHERE active = true AND capability = $1 AND unit_type = $2
        ORDER BY price_inr DESC`,
      [capability, unitType]
    )
    .then(r => r.rows)
    .catch(() => [])
  if (rows.length === 0) return NextResponse.json({ priceInr: null, unitType, charged: true })
  const preferred = PREFERRED[quality]
  // Highest-priced row of the preferred provider, else the wildcard row, else the highest: an
  // estimate that does not undershoot; the charge is trued up to the provider that served it.
  const row = (preferred && rows.find(r => r.provider === preferred)) || rows.find(r => r.model === '*') || rows[0]
  return NextResponse.json({ priceInr: Number(row.price_inr), unitType, provider: row.provider, charged: true })
}
