import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { revokeAllForAdmin } from '@/lib/auth/api-tokens'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Log out everywhere: revoke all of the logged-in admin's own sessions, CLI and extension tokens.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const revoked = await revokeAllForPrincipal('admin', admin.adminId)
  const tokensRevoked = await revokeAllForAdmin(getCurrentTenant()?.tenantId ?? request.headers.get('x-tenant-id'), admin.adminId).catch(() => 0)
  return NextResponse.json({ success: true, revoked, tokensRevoked })
}
