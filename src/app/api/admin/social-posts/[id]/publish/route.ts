import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
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
  // Tenants may only publish their own posts; flagship (null ALS tenant) publishes platform posts.
  if (post.tenant_id !== getCurrentTenantId()) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const result = await publishScheduledPost(post)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
