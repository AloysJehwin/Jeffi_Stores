import { NextRequest, NextResponse } from 'next/server'
import { decideAction } from '@/lib/support/agent/actions'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// The customer confirms or declines a change the assistant offered.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string; actionId: string }> }) {
  const { sessionId, actionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const { decision } = await request.json().catch(() => ({}))
  if (decision !== 'confirm' && decision !== 'decline') return NextResponse.json({ error: 'decision must be confirm or decline' }, { status: 400 })
  const r = await decideAction(actionId, sessionId, decision)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, status: r.action.status })
}
