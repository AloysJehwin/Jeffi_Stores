import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { deleteConversation, updateConversation } from '@/lib/admin-agent/conversations'

export const dynamic = 'force-dynamic'

// Rename or share/unshare a chat (owner only).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { title?: unknown; shared?: unknown }
  const patch: { title?: string; shared?: boolean } = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.shared === 'boolean') patch.shared = body.shared
  if (!(await updateConversation(admin.adminId, id, patch))) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await deleteConversation(admin.adminId, id))) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
