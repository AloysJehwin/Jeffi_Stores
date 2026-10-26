import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { generateImage } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'
import { query, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// POST /api/admin/product-offers/[id]/generate-image
// Body: { prompt: string, field?: 'image_url' | 'image_url_mobile' | 'image_url_card' }
// Generates an offer banner through the AI gateway (charged as offer_image), persisted to S3, and saves the URL on the offer.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'coupons:write')
    if (admin instanceof NextResponse) return admin
    const denied = aiDenial(admin.role, admin.scopes, 'coupons:write')
    if (denied) return NextResponse.json({ error: denied }, { status: 403 })
    const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
    if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

    const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (rawPrompt.length < 3)
      return NextResponse.json({ error: 'Describe the scene you want (a few words at least).' }, { status: 400 })
    const field = body?.field === 'image_url_mobile' || body?.field === 'image_url_card' ? body.field : 'image_url'
    const card = field === 'image_url_card'
    const prompt = card
      ? `${rawPrompt}. Professional promotional offer card, cinematic studio lighting, dark near-black background, subject in the upper two thirds leaving calm space at the bottom for text, high detail, photorealistic, 4:5 portrait.`
      : `${rawPrompt}. Professional promotional offer banner, cinematic studio lighting, dark near-black background, subject composed toward the right side leaving negative space on the left for text, high detail, photorealistic, wide 2.4:1 banner.`

    let url: string
    let blurhash: string | null | undefined
    try {
      const r = await generateImage({ feature: 'offer_image', prompt, width: card ? 1024 : 1536, height: card ? 1280 : 640, n: 1, ref: id, actor: admin.email ?? null })
      if (!r.images[0]) return NextResponse.json({ error: 'Model returned no image' }, { status: 502 })
      ;({ url, blurhash } = r.images[0])
    } catch (err) {
      return aiMediaErrorResponse(err, 'Image generation failed')
    }
    const hashField = card ? 'blurhash_card' : field === 'image_url_mobile' ? 'blurhash_mobile' : 'blurhash'

    await query(`UPDATE product_offers SET ${field} = $1, ${hashField} = $2, updated_at = NOW() WHERE id = $3`, [
      url,
      blurhash ?? null,
      id,
    ])
    return NextResponse.json({ url, field, blurhash })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Image generation failed' }, { status: 500 })
  }
}
