import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getSocialPost } from '@/lib/tenant-registry'
import { publishScheduledPost } from '@/lib/social/publisher'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const post = await getSocialPost(id)
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  if (post.tenant_id !== null) {
    return NextResponse.json({ error: 'Not a platform post' }, { status: 403 })
  }

  const result = await publishScheduledPost(post)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
