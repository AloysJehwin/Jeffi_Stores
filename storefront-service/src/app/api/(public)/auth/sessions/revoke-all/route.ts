import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Log out everywhere: revoke all of the caller's own sessions.
export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const revoked = await revokeAllForPrincipal('customer', auth.userId)
  return NextResponse.json({ success: true, revoked })
}
