import { NextRequest, NextResponse } from 'next/server'
import { getSessionDto } from '@/lib/support/sessions'
import { handBackToAi } from '@/lib/support/admin'
import { adminChat, agentRef } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// Give the chat back to the assistant.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:write')
  if (ctx instanceof NextResponse) return ctx
  if (ctx.session.status !== 'open') return NextResponse.json({ error: 'This chat is closed' }, { status: 409 })
  await handBackToAi(ctx.session, await agentRef(ctx.admin))
  return NextResponse.json({ session: await getSessionDto(sessionId) })
}
