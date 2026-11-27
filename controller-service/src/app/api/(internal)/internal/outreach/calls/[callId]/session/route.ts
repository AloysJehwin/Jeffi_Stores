import { NextRequest, NextResponse } from 'next/server'
import { buildVoiceSession } from '@controller/lib/outreach/agent/runtime'
import { UUID_RE, verifyVoiceRequest } from '@controller/lib/outreach/voice-client'

export const dynamic = 'force-dynamic'

// voice-service → controller: persona, script, greeting and tools for one call. Service token, `service: "voice"`.
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params
  if (!verifyVoiceRequest(req, callId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!UUID_RE.test(callId)) return NextResponse.json({ error: 'Invalid call id' }, { status: 400, headers: NO_STORE })
  try {
    const session = await buildVoiceSession(callId)
    if (!session) return NextResponse.json({ error: 'Unknown call' }, { status: 404, headers: NO_STORE })
    return NextResponse.json(session, { headers: NO_STORE })
  } catch (e) {
    console.error('[outreach] session failed:', (e as Error)?.message)
    return NextResponse.json({ error: 'Session unavailable' }, { status: 500, headers: NO_STORE })
  }
}
