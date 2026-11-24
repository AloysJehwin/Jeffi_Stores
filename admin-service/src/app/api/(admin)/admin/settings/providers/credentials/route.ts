import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { platformOwnerOnly } from '@/lib/providers/admin-gate'
import { getSmsDltConfig } from '@/lib/providers/sms-dlt'
import {
  VoiceCredentialError,
  clearVoiceCredential,
  getVoiceConfigPublic,
  isVoiceCredentialProvider,
  saveVoiceCredential,
} from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// Outreach provider secrets (Exotel, Sarvam, Twilio test line, Claude for voice), stored encrypted under the
// platform id. Write-only: GET returns the settings with each secret as { configured, last4 }, never a value.
// Platform owner on the flagship only.

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:read'))
  if (admin instanceof NextResponse) return admin
  try {
    const [voice, dlt] = await Promise.all([getVoiceConfigPublic(), getSmsDltConfig(null, { fresh: true })])
    return NextResponse.json({ voice, dlt }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Could not load the Outreach providers' }, { status: 500, headers: NO_STORE })
  }
}

export async function PUT(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  if (!isVoiceCredentialProvider(b?.provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  try {
    const secrets = await saveVoiceCredential(b.provider, b.values)
    return NextResponse.json({ ok: true, provider: b.provider, secrets }, { headers: NO_STORE })
  } catch (err) {
    if (err instanceof VoiceCredentialError) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Could not save the credentials' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const provider = req.nextUrl.searchParams.get('provider')
  if (!isVoiceCredentialProvider(provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  try {
    await clearVoiceCredential(provider)
    return NextResponse.json({ ok: true, provider })
  } catch {
    return NextResponse.json({ error: 'Could not remove the credentials' }, { status: 500 })
  }
}
