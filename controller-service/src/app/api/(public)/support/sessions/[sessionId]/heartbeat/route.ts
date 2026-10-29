import { NextRequest, NextResponse } from 'next/server'
import { touchPresence } from '@/lib/support/sessions'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// Presence beat while the chat is on screen; `leaving` (sent with sendBeacon on pagehide) marks the
// customer away at once.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const raw = await request.text().catch(() => '')
  let leaving = false
  try {
    leaving = JSON.parse(raw || '{}')?.leaving === true
  } catch {
    leaving = raw.includes('leaving')
  }
  if (ctx.session.status !== 'open') return NextResponse.json({ ok: false, closed: true })
  const at = await touchPresence(sessionId, 'customer', leaving)
  return NextResponse.json({ ok: true, at, adminLastSeenAt: ctx.session.admin_last_seen_at })
}
