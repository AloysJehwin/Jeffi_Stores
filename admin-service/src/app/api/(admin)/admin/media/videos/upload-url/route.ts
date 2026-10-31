import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GALLERY_VIDEO_MAX_BYTES, presignGalleryVideoUpload } from '@/lib/shared/s3'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Gallery media is shared by the homepage, offer, product, social and WhatsApp template editors.
const WRITE_SCOPES = ['settings:write', 'coupons:write', 'products:write', 'social:write', 'templates:write'] as const

const Body = z.object({
  mimeType: z.enum(['video/mp4', 'video/webm']),
  size: z.number().int().positive(),
})

// POST /api/admin/media/videos/upload-url { mimeType, size } -> a presigned PUT to media/video/<uuid>.<ext>.
// The browser PUTs the file with that exact Content-Type, then registers it with POST /api/admin/media/videos.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_SCOPES.some(s => hasScope(admin.role, admin.scopes, s))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Upload an MP4 or WebM video' }, { status: 400 })
  if (body.data.size > GALLERY_VIDEO_MAX_BYTES)
    return NextResponse.json({ error: 'Video must be under 50 MB' }, { status: 413 })

  try {
    const r = await presignGalleryVideoUpload(body.data.mimeType, body.data.size)
    return NextResponse.json({ ...r, mimeType: body.data.mimeType, maxBytes: GALLERY_VIDEO_MAX_BYTES })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'Could not start the upload' }, { status: 500 })
  }
}
