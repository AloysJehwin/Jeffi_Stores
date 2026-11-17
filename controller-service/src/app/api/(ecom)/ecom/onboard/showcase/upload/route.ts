import { NextRequest, NextResponse } from 'next/server'
import { fail, studioOwner } from '@controller/lib/site-studio/http'
import { SHOWCASE_IMAGE_MAX_BYTES, SHOWCASE_IMAGE_TYPES, uploadShowcaseImage, type ShowcaseImageKind } from '@controller/lib/showcase-builder/uploads'

export const dynamic = 'force-dynamic'

const KINDS: ShowcaseImageKind[] = ['logo', 'service', 'work', 'avatar']

// A picture for the owner's Showcase (multipart: file, kind = logo | service | work | avatar) → { url }. Resized and
// stored as WebP; the Details step and the editor save the URL with the site.
export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const form = await request.formData().catch(() => null)
  if (!form) return fail('Invalid form data')
  const file = form.get('file')
  const kind = form.get('kind')
  if (!file || typeof file === 'string') return fail('Choose a picture to upload.')
  if (typeof kind !== 'string' || !KINDS.includes(kind as ShowcaseImageKind)) return fail('Unknown picture kind.')
  if (file.size > SHOWCASE_IMAGE_MAX_BYTES) return fail(`That picture is too large (up to ${SHOWCASE_IMAGE_MAX_BYTES / 1024 / 1024} MB).`)
  if (!SHOWCASE_IMAGE_TYPES.includes(file.type)) return fail('Use a JPG, PNG or WebP picture.')
  try {
    const { url } = await uploadShowcaseImage(Buffer.from(await file.arrayBuffer()), owner.id, kind as ShowcaseImageKind)
    return NextResponse.json({ ok: true, url })
  } catch (err) {
    console.error('[showcase] upload failed:', (err as Error).message)
    return fail('That picture could not be uploaded. Try another one.', 422)
  }
}
