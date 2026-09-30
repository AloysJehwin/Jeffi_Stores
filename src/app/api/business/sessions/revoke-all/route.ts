import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Log out everywhere: revoke all of the caller's own business sessions.
export async function POST(request: NextRequest) {
  const auth = await authenticateBusiness(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const revoked = await revokeAllForPrincipal('business', auth.userId)
  return NextResponse.json({ success: true, revoked })
}
