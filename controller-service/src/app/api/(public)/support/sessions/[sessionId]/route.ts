import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/shared/activity'
import { closeSession, getSessionDto } from '@/lib/support/sessions'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await customerChat(request, sessionId)
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json({ session: await getSessionDto(sessionId) })
  } catch (err) {
    console.error('[support] session GET', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// The customer ends their chat.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await customerChat(request, sessionId)
    if (ctx instanceof NextResponse) return ctx
    const body = await request.json().catch(() => ({}))
    if (body?.status && body.status !== 'closed') return NextResponse.json({ error: 'Only closing a chat is supported' }, { status: 400 })
    if (await closeSession(sessionId)) {
      logActivity({ userId: ctx.user.userId, kind: 'support_message', referenceId: sessionId, referenceType: 'support_sessions', summary: 'Customer ended the support chat' }).catch(() => {})
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[support] close', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
