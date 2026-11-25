import { NextRequest, NextResponse } from 'next/server'
import { outreachGuard, serverError } from '@controller/lib/outreach/guard'
import { getCallDetail } from '@controller/lib/outreach/call-events'
import { UUID_RE } from '@controller/lib/outreach/voice-client'

export const dynamic = 'force-dynamic'

// GET → { call, recordingUrl, events }: the call row (transcript as { role: agent|caller, text, at }, consent),
// a 15-minute signed URL for the recording, and the call's audit events. Platform admin only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid call id' }, { status: 400 })
  try {
    const detail = await getCallDetail(id)
    if (!detail) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return serverError(e)
  }
}
