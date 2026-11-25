import { NextRequest, NextResponse } from 'next/server'
import { verifyServiceToken } from '@jeffi/service-auth'
import { getVoiceConfigView } from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// voice-service → controller: the Outreach call config, non-secret only (lib/providers/voice-config.ts).
// Credentials never travel here: voice-service reads its own copy of the platform secrets from its env.
// Auth: a service token (packages/service-auth, SERVICE_AUTH_SECRET) whose `service` claim is "voice".

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
    return NextResponse.json(await getVoiceConfigView(), { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Voice config unavailable' }, { status: 503, headers: NO_STORE })
  }
}
