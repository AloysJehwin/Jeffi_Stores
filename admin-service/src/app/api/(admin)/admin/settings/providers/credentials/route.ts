import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { platformOwnerOnly } from '@/lib/providers/admin-gate'
import { getSmsDltConfig } from '@/lib/providers/sms-dlt'
import { getVoiceConfigView, voiceSecretsStatus } from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// Outreach calling config and which platform secrets are set (names and presence only, never a value).
// Credentials live in the platform secrets, so there is nothing to write here. Platform owner on the flagship only.

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:read'))
  if (admin instanceof NextResponse) return admin
  try {
    const [voice, dlt] = await Promise.all([getVoiceConfigView(), getSmsDltConfig(null, { fresh: true })])
    return NextResponse.json({ voice, secrets: voiceSecretsStatus(), dlt }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Could not load the Outreach providers' }, { status: 500, headers: NO_STORE })
  }
}
