import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { platformOwnerOnly } from '@/lib/providers/admin-gate'
import { testExotelCredentials } from '@/lib/providers/voice-config'

export const dynamic = 'force-dynamic'

// Read-only check of saved Outreach credentials. Exotel only: a balance read, no call placed. Sarvam has no
// read-only endpoint, so it has no test. Platform owner on the flagship only.
export async function POST(req: NextRequest) {
  const admin = await platformOwnerOnly(await requireAdminScope(req, 'settings:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  if (b?.provider !== 'exotel') return NextResponse.json({ error: 'Only Exotel can be tested' }, { status: 400 })
  try {
    return NextResponse.json(await testExotelCredentials(), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not run the test' }, { status: 500 })
  }
}
