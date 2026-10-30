import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { EditSchema, cancelPost, editPost } from '@/lib/social/posts'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const parsed = EditSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid edit' }, { status: 400 })
  const post = await editPost(await resolveTenantId(), (await params).id, parsed.data)
  if (!post) return NextResponse.json({ error: 'Only drafts, queued, failed or cancelled posts can be edited' }, { status: 409 })
  return NextResponse.json({ post })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const ok = await cancelPost(await resolveTenantId(), (await params).id)
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: 'Only drafts, queued or failed posts can be cancelled' }, { status: 409 })
}
