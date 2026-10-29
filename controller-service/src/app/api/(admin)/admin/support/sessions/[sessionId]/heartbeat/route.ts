import { NextRequest, NextResponse } from 'next/server'
import { touchPresence } from '@/lib/support/sessions'
import { adminChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

// The agent has the conversation open; returns the customer's last-seen time for the presence dot.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:read', { passive: true })
  if (ctx instanceof NextResponse) return ctx
  const raw = await request.text().catch(() => '')
  const leaving = raw.includes('"leaving":true')
  const at = await touchPresence(sessionId, 'admin', leaving)
  return NextResponse.json({ ok: true, at, customerLastSeenAt: ctx.session.customer_last_seen_at })
}
