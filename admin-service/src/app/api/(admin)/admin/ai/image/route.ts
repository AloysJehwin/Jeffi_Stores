export const maxDuration = 180
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { AI_IMAGE_FEATURES } from '@/lib/ai/media-features'
import { AI_FEATURE_SCOPES } from '@/lib/ai/scope-map'
import { generateImage } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

const Body = z.object({
  feature: z.enum(AI_IMAGE_FEATURES),
  prompt: z.string().trim().min(3).max(2000),
  negativePrompt: z.string().max(500).optional(),
  width: z.number().int().min(256).max(1536).optional(),
  height: z.number().int().min(256).max(1536).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: z.enum(['draft', 'standard', 'premium']).optional(),
  referenceImageUrl: z.string().url().optional(),
  seed: z.number().int().optional(),
  transparent: z.boolean().optional(),
  ref: z.string().max(80).optional(),
  attachToProductId: z.string().uuid().optional(),
  saveToGallery: z.boolean().optional(),
})

// POST /api/admin/ai/image: generate, charge and persist images for one admin feature.
export async function POST(request: NextRequest) {
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || 'Invalid body' }, { status: 400 })
  const { feature } = body.data
  // One literal :write scope per feature (the write-scope audit reads these).
  const admin =
    feature === 'social_image' ? await requireAdminScope(request, 'social:write')
    : feature === 'product_image' ? await requireAdminScope(request, 'products:write')
    : feature === 'ads_image' ? await requireAdminScope(request, 'google_ads_campaigns:write')
    : feature === 'email_hero' ? await requireAdminScope(request, 'mailer:write')
    : feature === 'offer_image' ? await requireAdminScope(request, 'coupons:write')
    : feature === 'meta_ads_image' ? await requireAdminScope(request, 'meta_ads_campaigns:write')
    : feature === 'brand_image' ? await requireAdminScope(request, 'brands:write')
    : feature === 'category_image' ? await requireAdminScope(request, 'categories:write')
    : feature === 'campaign_image' ? await requireAdminScope(request, 'campaigns:write')
    : feature === 'template_image' ? await requireAdminScope(request, 'templates:write')
    // hero_image, homepage_image, generate_image, logo_image
    : await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, AI_FEATURE_SCOPES[feature])
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  // attachToProductId writes product_images, so it also needs products:write.
  if (body.data.attachToProductId && aiDenial(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  try {
    const r = await generateImage({ ...body.data, actor: admin.email ?? null, tenantId: await resolveTenantId() })
    return NextResponse.json({ images: r.images, provider: r.provider, model: r.model, usageId: r.usageId, priceInr: r.priceInr })
  } catch (err) {
    return aiMediaErrorResponse(err, 'Image generation failed')
  }
}
