import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { generateImage } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'
import { applyDraftPatch, getEditableHomepage, homepageLockFrom, withHomepageDraft, homepageDraftIdFrom, homepageDraftOr, noHomepageDraft } from '@/lib/catalog/homepage-draft'
import { actorOf, lockedByOther } from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// POST /api/admin/hero-slides/[id]/generate-image
// Body: { prompt: string, field?: 'image_url' | 'image_url_mobile' }
// Generates a hero banner through the AI gateway (charged as hero_image), persisted to S3, and saves the URL on the draft slide.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'settings:write')
    if (admin instanceof NextResponse) return admin
    const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
    if (denied) return NextResponse.json({ error: denied }, { status: 403 })
    const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
    if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

    // Refuse before spending on the image when another admin holds the draft.
    const draftId = homepageDraftIdFrom(request)
    if (!draftId) return noHomepageDraft()
    const held = await lockedByOther(actorOf(admin), 'homepage', draftId)
    if (held) return held
    const { heroSlides } = await getEditableHomepage(draftId)
    if (!heroSlides.some(s => s.id === id)) return NextResponse.json({ error: 'Slide not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (rawPrompt.length < 3)
      return NextResponse.json({ error: 'Describe the scene you want (a few words at least).' }, { status: 400 })
    const field = body?.field === 'image_url_mobile' ? 'image_url_mobile' : 'image_url'

    // Wide cinematic hero framing. Nudge the model toward a dark, product-hero look
    // that matches the site's carousel treatment (dark bg, subject on the right).
    const prompt = `${rawPrompt}. Professional product hero banner, cinematic studio lighting, dark near-black background, subject composed toward the right side leaving negative space on the left for text, high detail, photorealistic, 16:9 wide banner.`

    let url: string
    let blurhash: string | null | undefined
    try {
      const r = await generateImage({ feature: 'hero_image', prompt, width: 1536, height: 640, n: 1, ref: id, actor: admin.email ?? null })
      if (!r.images[0]) return NextResponse.json({ error: 'Model returned no image' }, { status: 502 })
      ;({ url, blurhash } = r.images[0])
    } catch (err) {
      return aiMediaErrorResponse(err, 'Image generation failed')
    }
    const hashField = field === 'image_url_mobile' ? 'blurhash_mobile' : 'blurhash'

    const saved = await withHomepageDraft(draftId, admin.adminId, draft => {
      const slide = draft.heroSlides.find(s => s.id === id)
      if (slide) applyDraftPatch(slide, { [field]: url, [hashField]: blurhash ?? null })
      return !!slide
    }, homepageLockFrom(admin, request)).catch(homepageDraftOr)
    if (saved instanceof NextResponse) return saved
    if (!saved) return NextResponse.json({ error: 'Slide not found' }, { status: 404 })
    return NextResponse.json({ url, field, blurhash })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Image generation failed' }, { status: 500 })
  }
}
