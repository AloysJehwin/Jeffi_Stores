import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { checkPincodeServiceability } from '@/lib/shipping/delhivery'

export const dynamic = 'force-dynamic'

// Checks a pickup pincode while the owner is still on the form. Owner-authenticated so the
// serviceability map is not an open endpoint.
export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const pin = request.nextUrl.searchParams.get('pin') ?? ''
  const result = await checkPincodeServiceability(pin)
  return NextResponse.json(result)
}
