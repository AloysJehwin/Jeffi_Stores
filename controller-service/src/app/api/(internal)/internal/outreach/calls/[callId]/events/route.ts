import { NextRequest, NextResponse } from 'next/server'
import { handleCallEvent } from '@controller/lib/outreach/call-events'
import { UUID_RE, verifyVoiceRequest } from '@controller/lib/outreach/voice-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// voice-service → controller: { type, at, data } for ringing, answered, transcript batches and the one terminal event.
// Service token, `service: "voice"`. A repeated terminal event is acknowledged (200, duplicate) so retries stop.
export async function POST(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params
  if (!verifyVoiceRequest(req, callId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID_RE.test(callId)) return NextResponse.json({ error: 'Invalid call id' }, { status: 400 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { type?: unknown }).type !== 'string') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  try {
    const r = await handleCallEvent(callId, body as { type: string; at?: unknown; data?: unknown })
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) {
    console.error('[outreach] call event failed:', (e as Error)?.message)
    return NextResponse.json({ error: 'Event not recorded' }, { status: 500 })
  }
}
