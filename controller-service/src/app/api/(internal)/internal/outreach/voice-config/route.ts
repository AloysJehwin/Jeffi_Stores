import { NextRequest, NextResponse } from 'next/server'
import { verifyServiceToken } from '@jeffi/service-auth'
import { getVoiceConfig } from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// voice-service → controller: the Outreach call config with decrypted secrets (lib/providers/voice-config.ts).
// Auth: a service token (packages/service-auth, SERVICE_AUTH_SECRET) whose `service` claim is "voice".
// The body carries secrets: never cached, never logged.

const VOICE_SERVICES = new Set(['voice', 'voice-service'])
const NO_STORE = { 'Cache-Control': 'no-store' }

function caller(req: NextRequest) {
  const h = req.headers.get('authorization') || ''
  const token = /^bearer /i.test(h) ? h.slice(7).trim() : undefined
  try {
    return verifyServiceToken(token)
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const claims = caller(req)
  if (!claims || !VOICE_SERVICES.has(claims.service)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  try {
    return NextResponse.json(await getVoiceConfig(), { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Voice config unavailable' }, { status: 503, headers: NO_STORE })
  }
}
