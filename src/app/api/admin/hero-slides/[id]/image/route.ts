import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { uploadGalleryImage } from '@/lib/s3'
import { applyDraftPatch, getEditableHomepage, withHomepageDraft } from '@/lib/homepage-draft'

export const dynamic = 'force-dynamic'

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']
const MAX = 5 * 1024 * 1024

// POST /api/admin/hero-slides/[id]/image — upload a slide banner image onto the draft slide.
// FormData: file, plus optional field=image_url|image_url_mobile (default image_url).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { heroSlides } = await getEditableHomepage()
    if (!heroSlides.some(s => s.id === id)) return NextResponse.json({ error: 'Slide not found' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const field = (formData.get('field') as string) === 'image_url_mobile' ? 'image_url_mobile' : 'image_url'
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
    if (file.size > MAX) return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const { url, blurhash } = await uploadGalleryImage(buffer, file.name)
    const hashField = field === 'image_url_mobile' ? 'blurhash_mobile' : 'blurhash'

    const saved = await withHomepageDraft(admin.adminId, draft => {
      const slide = draft.heroSlides.find(s => s.id === id)
      if (slide) applyDraftPatch(slide, { [field]: url, [hashField]: blurhash ?? null })
      return !!slide
    })
    if (!saved) return NextResponse.json({ error: 'Slide not found' }, { status: 404 })
    return NextResponse.json({ url, field, blurhash })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to upload image' }, { status: 500 })
  }
}
