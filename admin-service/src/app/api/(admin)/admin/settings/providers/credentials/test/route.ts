import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { platformOwnerOnly } from '@/lib/providers/admin-gate'
import {
  testAzureSpeechCredentials,
  testExotelCredentials,
  testSarvamCredentials,
  testTwilioCredentials,
} from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// Read-only check of the Outreach secrets in the platform's env. Exotel: a balance read. Twilio: an account read.
// Azure Speech: a token request. Sarvam: an empty request that only shows whether the key is accepted.
// Nothing is called, spoken, transcribed or billed. Platform owner on the flagship only.
const TESTS = {
  exotel: testExotelCredentials,
  twilio_voice: testTwilioCredentials,
  azure_speech: testAzureSpeechCredentials,
  sarvam: testSarvamCredentials,
} as const

export async function POST(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  const test = typeof b?.provider === 'string' && Object.hasOwn(TESTS, b.provider) ? TESTS[b.provider as keyof typeof TESTS] : null
  if (!test) return NextResponse.json({ error: 'Only Exotel, Twilio, Sarvam and Azure Speech can be tested' }, { status: 400 })
  try {
    return NextResponse.json(await test(), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not run the test' }, { status: 500 })
  }
}
