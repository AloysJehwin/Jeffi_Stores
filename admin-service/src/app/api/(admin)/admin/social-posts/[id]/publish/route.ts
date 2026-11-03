import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { publishScheduledPost } from '@/lib/social/publisher'
import { claimPostNow } from '@/lib/social/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// "Post now": claims the post (so the cron cannot take it too) and publishes it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const post = await claimPostNow(await resolveTenantId(), (await params).id)
  if (!post) return NextResponse.json({ error: 'Post not found, already publishing, or waiting for approval' }, { status: 409 })
  const result = await publishScheduledPost(post)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
