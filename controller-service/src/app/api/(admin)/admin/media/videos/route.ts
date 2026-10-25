import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GalleryVideoError, listGalleryVideos, registerGalleryVideo } from '@/lib/shared/gallery-videos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Gallery media is shared by the homepage, offer, product and social editors.
const WRITE_SCOPES = ['settings:write', 'coupons:write', 'products:write', 'social:write'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/admin/media/videos?page=&limit=&search= — gallery videos, newest first.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(sp.get('page') || '1') || 1)
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '24') || 24))
  const search = (sp.get('search') || '').trim().slice(0, 100)
  const { videos, total } = await listGalleryVideos({ limit, offset: (page - 1) * limit, search: search || undefined })
  return NextResponse.json({ videos, total, page, limit })
}

const Body = z.object({
  key: z.string().max(200),
  mimeType: z.enum(['video/mp4', 'video/webm']),
  durationSeconds: z.number().nonnegative().max(9999).nullish(),
  width: z.number().int().positive().max(10000).nullish(),
  height: z.number().int().positive().max(10000).nullish(),
  posterUrl: z.string().url().max(2000).nullish(),
  posterBlurhash: z.string().max(64).nullish(),
  label: z.string().max(200).nullish(),
})

// POST /api/admin/media/videos — register an upload made through upload-url. The object must exist,
// be under 50 MB and be the declared MP4/WebM; otherwise it is deleted.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_SCOPES.some(s => hasScope(admin.role, admin.scopes, s))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return NextResponse.json({ error: body.error.issues[0]?.message || 'Invalid body' }, { status: 400 })
  const d = body.data
  try {
    const video = await registerGalleryVideo({
      key: d.key,
      mime: d.mimeType,
      durationSeconds: d.durationSeconds,
      width: d.width,
      height: d.height,
      posterUrl: d.posterUrl,
      posterBlurhash: d.posterBlurhash,
      label: d.label,
      createdBy: UUID_RE.test(admin.adminId ?? '') ? admin.adminId : null,
    })
    return NextResponse.json({ video })
  } catch (err) {
    if (err instanceof GalleryVideoError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: (err as Error).message || 'Could not save the video' }, { status: 500 })
  }
}
