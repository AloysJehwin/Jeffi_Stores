import { NextRequest, NextResponse } from 'next/server'
import { getSessionDto } from '@/lib/support/sessions'
import { closeChat } from '@/lib/support/admin'
import { adminChat, agentRef } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:read', { passive: true })
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ session: await getSessionDto(sessionId) })
}

// Close the chat (resolved, or the customer went quiet).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await adminChat(request, sessionId, 'customers:write')
    if (ctx instanceof NextResponse) return ctx
    const { status } = await request.json().catch(() => ({}))
    if (status !== 'closed') return NextResponse.json({ error: 'Only closing a chat is supported' }, { status: 400 })
    const ok = await closeChat(ctx.session, await agentRef(ctx.admin))
    if (!ok) return NextResponse.json({ error: 'Chat not found or already closed' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[support] admin close', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
