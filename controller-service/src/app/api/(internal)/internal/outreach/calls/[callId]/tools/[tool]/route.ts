import { NextRequest, NextResponse } from 'next/server'
import { runTool } from '@controller/lib/outreach/tools'
import { UUID_RE, verifyVoiceRequest } from '@controller/lib/outreach/voice-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// voice-service → controller: one call tool, { args } → { ok, say?, end?, redialLanguage? }. Service token, `service: "voice"`.
export async function POST(req: NextRequest, { params }: { params: Promise<{ callId: string; tool: string }> }) {
  const { callId, tool } = await params
  if (!verifyVoiceRequest(req, callId)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!UUID_RE.test(callId)) return NextResponse.json({ ok: false, error: 'Invalid call id' }, { status: 400 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  try {
    const r = await runTool(callId, tool, (body as { args?: unknown }).args)
    return NextResponse.json(r.body, { status: r.status })
  } catch (e) {
    console.error(`[outreach] tool ${tool} errored:`, (e as Error)?.message)
    return NextResponse.json({ ok: false, error: 'Tool failed' }, { status: 500 })
  }
}
