import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listPosts } from '@/lib/social/data'
import { ComposeSchema, composePosts } from '@/lib/social/posts'

export const dynamic = 'force-dynamic'

// The post queue: a store sees only its own posts; the flagship (no tenant) sees the platform queue.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const posts = await listPosts(await resolveTenantId(), { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined })
  return NextResponse.json({ posts })
}

// Compose one post to several networks. Admins without approval rights queue it for approval.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = ComposeSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid post' }, { status: 400 })
  const canApprove = hasScope(admin.role, admin.scopes, 'social:approve')
  const posts = await composePosts(await resolveTenantId(), parsed.data, {
    approval: !canApprove || !!parsed.data.requestApproval,
    createdBy: admin.email ?? admin.adminId ?? null,
  })
  return NextResponse.json({ posts, post: posts[0] })
}
