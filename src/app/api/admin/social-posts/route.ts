import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { listJeffiSocialPosts, enqueueSocialPost } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['fb', 'ig', 'ig_reel'] as const
type Platform = (typeof PLATFORMS)[number]

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const posts = await listJeffiSocialPosts()
  return NextResponse.json({ posts })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const platform = body.platform as Platform
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'platform must be one of fb, ig, ig_reel' }, { status: 400 })
  }

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
  if (scheduledAt && isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledAt' }, { status: 400 })
  }

  const post = await enqueueSocialPost({
    tenantId: null,
    productId: body.productId ?? null,
    platform,
    caption: body.caption ?? null,
    hashtags: body.hashtags ?? null,
    imageUrl: body.imageUrl ?? null,
    videoUrl: body.videoUrl ?? null,
    scheduledAt,
  })
  return NextResponse.json({ post })
}
