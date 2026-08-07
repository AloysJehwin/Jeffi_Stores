import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { revokeAllForPrincipal } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Log out everywhere: revoke all of the logged-in admin's own sessions.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const revoked = await revokeAllForPrincipal('admin', admin.adminId)
  return NextResponse.json({ success: true, revoked })
}
