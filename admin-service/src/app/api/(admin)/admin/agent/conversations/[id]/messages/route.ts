import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { conversationAccess, conversationMeta } from '@/lib/admin-agent/conversations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Own chats, or one another admin has shared (read-only).
  const access = await conversationAccess(admin.adminId, id)
  if (access === 'none') return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (access === 'denied') return NextResponse.json({ error: 'Not your conversation' }, { status: 403 })

  const messages = await queryMany<{
    id: string
    role: string
    content: string
    tool_calls: any
    ui_blocks: any
    proposed_actions: any
    pickers: any
    created_at: string
  }>(
    `SELECT id::text, role, content, tool_calls, ui_blocks, proposed_actions, pickers, created_at::text
       FROM admin_agent_messages
      WHERE conversation_id = $1::uuid
      ORDER BY created_at ASC`,
    [id]
  )

  const meta = await conversationMeta(id)
  return NextResponse.json({
    messages,
    title: meta?.title ?? null,
    shared: meta?.shared ?? false,
    readOnly: access === 'shared',
    ownerName: access === 'shared' ? (meta?.owner_name ?? null) : null,
  })
}
